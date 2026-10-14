import { beforeEach, describe, expect, it, vi } from "vitest";

// Fronteiras mockadas: redirect do Next (lança, como o real), a resolução de sessão/tenant e a execução no banco. A validação, a escolha do
// escopo e as mensagens que vão à interface são a lógica REAL de actions.ts.
vi.mock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }) }));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/identity", () => ({ requestIdentity: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ appPool: vi.fn(), dbOrigin: vi.fn() }));
vi.mock("@/lib/server/tenant-data", async (orig) => ({ ...(await orig<typeof import("@/lib/server/tenant-data")>()), resolveTenantContext: vi.fn() }));
vi.mock("@plataforma/api", async (orig) => ({ ...(await orig<typeof import("@plataforma/api")>()), runGeneration: vi.fn(), withTenant: vi.fn(), getPageDetail: vi.fn() }));

import { notFound } from "next/navigation";
import { DynamicServerError } from "next/dist/client/components/hooks-server-context";
import * as api from "@plataforma/api";
import { resolveTenantContext } from "@/lib/server/tenant-data";
import { generateAction, reprocessAction } from "./actions";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POOL = { fake: "pool" } as never;
const ID = api.devIdentity([A]);
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT_PAGE_ID = "44444444-4444-4444-8444-444444444444";
const ENTITY_ID = "33333333-3333-4333-8333-333333333333";
const mCtx = vi.mocked(resolveTenantContext);
const mRun = vi.mocked(api.runGeneration);
const mWith = vi.mocked(api.withTenant);
const mDetail = vi.mocked(api.getPageDetail);
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
const okCtx = () => mCtx.mockResolvedValue({ ok: true, pool: POOL, identity: ID, tenantId: A });
const ok = { runId: RUN_ID, status: "succeeded", total: 20, generated: 20, unchanged: 0, blocked: 0, items: [] } as never;

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  log = vi.spyOn(console, "error").mockImplementation(() => undefined); // o log interno não polui a saída; cada teste confere o que foi registrado
  okCtx();
  mRun.mockResolvedValue(ok);
  mWith.mockImplementation(async (_p, _i, _t, fn) => fn({ query: vi.fn() } as never));
});

describe("generateAction: validação ANTES de qualquer efeito", () => {
  const invalid: [string, Record<string, string>, "uf" | "limit"][] = [
    ["UF vazia", { uf: "", limit: "20" }, "uf"], ["UF inexistente", { uf: "XX", limit: "20" }, "uf"], ["UF com injeção", { uf: "SP'; DROP TABLE plataforma.page;--", limit: "20" }, "uf"],
    ["limite vazio", { uf: "SP", limit: "" }, "limit"], ["limite zero", { uf: "SP", limit: "0" }, "limit"], ["limite acima do teto", { uf: "SP", limit: "501" }, "limit"],
    ["limite negativo", { uf: "SP", limit: "-5" }, "limit"], ["limite decimal", { uf: "SP", limit: "1.5" }, "limit"], ["limite em notação científica", { uf: "SP", limit: "20e1" }, "limit"],
    ["limite com texto", { uf: "SP", limit: "vinte" }, "limit"], ["limite com espaço interno", { uf: "SP", limit: "2 0" }, "limit"],
  ];
  for (const [nome, fields, campo] of invalid) {
    it(`${nome}: erro no campo e NADA é executado (nem sessão, nem banco)`, async () => {
      const r = await generateAction(null, form(fields));
      expect(r?.fieldErrors?.[campo]).toMatch(/\S/);
      expect(r?.error).toBeUndefined();
      expect(mRun).not.toHaveBeenCalled();
      expect(mCtx).not.toHaveBeenCalled();
    });
  }
  it("campos ausentes do formulário: os dois erros", async () => {
    const r = await generateAction(null, new FormData());
    expect(Object.keys(r!.fieldErrors!).sort()).toEqual(["limit", "uf"]);
    expect(mRun).not.toHaveBeenCalled();
  });
  it("os dois campos inválidos: os dois erros de uma vez", async () => {
    expect(Object.keys((await generateAction(null, form({ uf: "ZZ", limit: "0" })))!.fieldErrors!).sort()).toEqual(["limit", "uf"]);
  });
});

describe("generateAction: execução", () => {
  it("válido: roda com o tenant e a identidade da SESSÃO e leva à execução criada", async () => {
    await expect(generateAction(null, form({ uf: "sp", limit: "20" }))).rejects.toThrow(`NEXT_REDIRECT:/generation/runs/${RUN_ID}`);
    expect(mRun).toHaveBeenCalledExactlyOnceWith(POOL, ID, A, { scope: { uf: "SP", limit: 20 } }); // UF normalizada
  });
  it("aceita os limites 1 e 500 (bordas)", async () => {
    for (const limit of ["1", "500"]) await expect(generateAction(null, form({ uf: "RO", limit }))).rejects.toThrow("NEXT_REDIRECT");
    expect(mRun.mock.calls.map((c) => c[3].scope)).toEqual([{ uf: "RO", limit: 1 }, { uf: "RO", limit: 500 }]);
  });
  it("tenant enviado pelo cliente é IGNORADO: o escopo vem da sessão", async () => {
    await expect(generateAction(null, form({ uf: "SP", limit: "5", tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", tenant_id: "x", cityIds: "y" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(mRun.mock.calls[0]![2]).toBe(A);
    expect(mRun.mock.calls[0]![3]).toEqual({ scope: { uf: "SP", limit: 5 } });
  });
  const blocked: [string, Parameters<typeof mCtx.mockResolvedValue>[0], RegExp][] = [
    ["sessão expirada", { ok: false, reason: "unauthenticated" }, /Sua sessão expirou/],
    ["sem workspace", { ok: false, reason: "no_tenant" }, /não está associado a um workspace/],
    ["sem configuração", { ok: false, reason: "not_configured", missing: "banco" }, /não está configurada/],
  ];
  for (const [nome, ctx, msg] of blocked) {
    it(`${nome}: mensagem clara e nenhuma geração`, async () => {
      mCtx.mockResolvedValue(ctx);
      expect((await generateAction(null, form({ uf: "SP", limit: "20" })))?.error).toMatch(msg);
      expect(mRun).not.toHaveBeenCalled();
    });
  }
  const failures: [string, unknown, RegExp][] = [
    ["execução já em andamento", new api.GenerationBusyError(RUN_ID), /Já existe uma geração em andamento/],
    ["cidade inexistente", new api.GenerationScopeError(["x"]), /Alguma cidade pedida não existe/],
    ["migrations pendentes (42P01)", Object.assign(new Error("x"), { code: "42P01" }), /migrations 0005 a 0007 precisam ser aplicadas/],
    ["falha qualquer", new Error("falha com postgresql://u:SEGREDO@host/db"), /Não foi possível gerar agora/],
  ];
  for (const [nome, err, msg] of failures) {
    it(`${nome}: mensagem compreensível, sem redirecionar e sem vazar o erro cru`, async () => {
      mRun.mockRejectedValue(err);
      const r = await generateAction(null, form({ uf: "SP", limit: "20" }));
      expect(r?.error).toMatch(msg);
      expect(r?.error).not.toMatch(/SEGREDO|postgresql:|Error:/);
      expect(r?.fieldErrors).toBeUndefined();
    });
  }
});

describe("reprocessAction: só a página do próprio tenant, sem publicação", () => {
  const detail = { page: { entityId: ENTITY_ID } } as never;
  it("reprocessa a CIDADE da página, com o tenant da sessão, e leva à execução", async () => {
    mDetail.mockResolvedValue(detail);
    await expect(reprocessAction(null, form({ pageId: PAGE_ID }))).rejects.toThrow(`NEXT_REDIRECT:/generation/runs/${RUN_ID}`);
    expect(mWith).toHaveBeenCalledExactlyOnceWith(POOL, ID, A, expect.any(Function));
    expect(mDetail).toHaveBeenCalledWith(expect.anything(), PAGE_ID);
    expect(mRun).toHaveBeenCalledExactlyOnceWith(POOL, ID, A, { scope: { cityIds: [ENTITY_ID] } }); // exatamente uma cidade
  });
  it("tenant e cidade enviados pelo cliente são ignorados (a cidade vem do banco, pela página)", async () => {
    mDetail.mockResolvedValue(detail);
    await expect(reprocessAction(null, form({ pageId: PAGE_ID, tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cityIds: "99999999-9999-4999-8999-999999999999", entityId: "x" }))).rejects.toThrow("NEXT_REDIRECT");
    expect(mRun.mock.calls[0]![2]).toBe(A);
    expect(mRun.mock.calls[0]![3]).toEqual({ scope: { cityIds: [ENTITY_ID] } });
  });
  it("página inexistente ou de outro workspace (a consulta devolve undefined): erro explícito e NENHUMA geração", async () => {
    mDetail.mockResolvedValue(undefined);
    expect(await reprocessAction(null, form({ pageId: PAGE_ID }))).toEqual({ error: "Página não encontrada neste workspace." });
    expect(mRun).not.toHaveBeenCalled();
  });
  it("sem sessão, sem workspace ou sem configuração: mensagem e nenhuma consulta nem geração", async () => {
    for (const [ctx, msg] of [[{ ok: false, reason: "unauthenticated" }, /Sua sessão expirou/], [{ ok: false, reason: "no_tenant" }, /workspace/], [{ ok: false, reason: "not_configured", missing: "x" }, /não está configurada/]] as const) {
      mCtx.mockResolvedValue(ctx);
      expect((await reprocessAction(null, form({ pageId: PAGE_ID })))?.error).toMatch(msg);
    }
    expect(mWith).not.toHaveBeenCalled();
    expect(mRun).not.toHaveBeenCalled();
  });
  it("falhas ao consultar a página ou ao gerar viram mensagens claras, sem redirecionar", async () => {
    mDetail.mockResolvedValue(detail);
    mRun.mockRejectedValueOnce(new api.GenerationBusyError(RUN_ID));
    expect((await reprocessAction(null, form({ pageId: PAGE_ID })))?.error).toMatch(/Já existe uma geração em andamento/);
    mRun.mockRejectedValueOnce(new api.GenerationScopeError([ENTITY_ID]));
    expect((await reprocessAction(null, form({ pageId: PAGE_ID })))?.error).toMatch(/não existe/);
    mWith.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "42P01" }));
    expect((await reprocessAction(null, form({ pageId: PAGE_ID })))?.error).toMatch(/migrations 0005 a 0007/);
    mWith.mockRejectedValueOnce(new Error("conexão caiu: postgresql://u:SEGREDO@h/d"));
    const generic = await reprocessAction(null, form({ pageId: PAGE_ID }));
    expect(generic?.error).toMatch(/Não foi possível gerar agora/);
    expect(generic?.error).not.toMatch(/SEGREDO|postgresql:/);
  });
  it("não há publicação implícita: a ação só pede geração (rascunho) e a API não oferece publicar", async () => {
    mDetail.mockResolvedValue(detail);
    await expect(reprocessAction(null, form({ pageId: PAGE_ID }))).rejects.toThrow("NEXT_REDIRECT");
    expect(Object.keys(api).filter((k) => /publi[cs]h|aprov|approve/i.test(k))).toEqual([]);
    expect(JSON.stringify(mRun.mock.calls[0]![3])).not.toMatch(/publi|status|approve/i);
  });
});

describe("falhas de infraestrutura e entrada inválida nas ações", () => {
  it("falha inesperada ao verificar a sessão (provedor de login fora): mensagem clara, nenhuma geração, nenhuma consulta e sem vazar a causa", async () => {
    mCtx.mockRejectedValue(new Error("falha ao buscar chaves em https://projeto.supabase.co/auth/v1/.well-known/jwks.json"));
    const g = await generateAction(null, form({ uf: "SP", limit: "20" }));
    const r = await reprocessAction(null, form({ pageId: PAGE_ID }));
    for (const x of [g, r]) { expect(x?.error).toMatch(/Não foi possível verificar sua sessão agora/); expect(x?.error).not.toMatch(/supabase|https?:/); }
    expect(mRun).not.toHaveBeenCalled();
    expect(mWith).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
  });
  it("banco indisponível é dito como tal (e não como erro genérico) em gerar e em reprocessar", async () => {
    mRun.mockRejectedValue(Object.assign(new Error("x"), { code: "ECONNREFUSED" }));
    expect((await generateAction(null, form({ uf: "SP", limit: "20" })))?.error).toMatch(/banco de dados não respondeu/);
    mDetail.mockResolvedValue({ page: { entityId: ENTITY_ID } } as never);
    expect((await reprocessAction(null, form({ pageId: PAGE_ID })))?.error).toMatch(/banco de dados não respondeu/);
    mWith.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "57014" }));
    expect((await reprocessAction(null, form({ pageId: PAGE_ID })))?.error).toMatch(/banco de dados não respondeu/);
  });
  it("falha inesperada é registrada no servidor (tipo e código, sem a mensagem) e a interface recebe a mensagem genérica", async () => {
    mRun.mockRejectedValue(Object.assign(new Error("falha com postgresql://u:SEGREDO@h/d"), { code: "XX000" }));
    await generateAction(null, form({ uf: "SP", limit: "20" }));
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).toContain("XX000");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SEGREDO|postgresql:/);
  });
  it("erros ESPERADOS (execução em andamento, cidade inexistente) não poluem o log de erros", async () => {
    mRun.mockRejectedValueOnce(new api.GenerationBusyError(RUN_ID));
    await generateAction(null, form({ uf: "SP", limit: "20" }));
    mRun.mockRejectedValueOnce(new api.GenerationScopeError(["x"]));
    await generateAction(null, form({ uf: "SP", limit: "20" }));
    expect(log).not.toHaveBeenCalled();
  });
  it("reprocessar: identificador mal formado é ENTRADA INVÁLIDA, dito como tal, e nada é consultado nem gerado", async () => {
    for (const bad of ["", "abc", "1", "../../etc", "22222222-2222-4222-8222-22222222222", "22222222-2222-4222-8222-2222222222222", `${PAGE_ID}'; DROP TABLE plataforma.page;--`]) {
      expect(await reprocessAction(null, form({ pageId: bad })), JSON.stringify(bad)).toEqual({ error: "Identificador de página inválido." });
    }
    expect(await reprocessAction(null, new FormData())).toEqual({ error: "Identificador de página inválido." });
    expect(mCtx).not.toHaveBeenCalled();
    expect(mWith).not.toHaveBeenCalled();
    expect(mRun).not.toHaveBeenCalled();
  });
  it("reprocessar uma página BEM FORMADA de outro tenant: o banco (RLS) devolve vazio, o erro é 'não encontrada' e NENHUMA geração roda", async () => {
    mDetail.mockResolvedValue(undefined);
    expect(await reprocessAction(null, form({ pageId: OTHER_TENANT_PAGE_ID }))).toEqual({ error: "Página não encontrada neste workspace." });
    expect(mDetail).toHaveBeenCalledWith(expect.anything(), OTHER_TENANT_PAGE_ID);
    expect(mRun).not.toHaveBeenCalled();
  });
  it("uma execução que TERMINA em `failed` (sem lançar) leva à tela da execução, onde o resultado real aparece: a ação não declara sucesso por conta própria", async () => {
    mDetail.mockResolvedValue({ page: { entityId: ENTITY_ID } } as never);
    mRun.mockResolvedValue({ runId: RUN_ID, status: "failed", total: 0, generated: 0, unchanged: 0, blocked: 0, items: [], error: "x" } as never);
    await expect(reprocessAction(null, form({ pageId: PAGE_ID }))).rejects.toThrow(`NEXT_REDIRECT:/generation/runs/${RUN_ID}`);
  });
});

describe("ações: erros do framework Next.js NÃO viram mensagem de falha da sessão", () => {
  // Erros REAIS do framework (gerados por ele mesmo); o `redirect` do módulo está mockado neste arquivo, então usamos notFound() e DynamicServerError.
  const real = (make: () => unknown): unknown => { try { make(); } catch (e) { return e; } throw new Error("a função do framework não lançou"); };
  const errors: [string, unknown][] = [["notFound()", real(() => notFound())], ["DynamicServerError", new DynamicServerError("Dynamic server usage: cookies")]];
  for (const [nome, err] of errors) {
    it(`${nome} lançado ao resolver o contexto é repassado nas duas ações; nada é executado nem registrado como falha`, async () => {
      mCtx.mockRejectedValue(err);
      await expect(generateAction(null, form({ uf: "SP", limit: "20" }))).rejects.toBe(err);
      await expect(reprocessAction(null, form({ pageId: PAGE_ID }))).rejects.toBe(err);
      expect(mRun).not.toHaveBeenCalled();
      expect(mWith).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });
  }
  it("controle: uma falha comum ao resolver o contexto CONTINUA virando a mensagem clara", async () => {
    mCtx.mockRejectedValue(new TypeError("fetch failed"));
    expect((await generateAction(null, form({ uf: "SP", limit: "20" })))?.error).toMatch(/Não foi possível verificar sua sessão agora/);
    expect(log).toHaveBeenCalledOnce();
  });
});
