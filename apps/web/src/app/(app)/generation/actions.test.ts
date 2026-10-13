import { beforeEach, describe, expect, it, vi } from "vitest";

// Fronteiras mockadas: redirect do Next (lança, como o real), a resolução de sessão/tenant e a execução no banco. A validação, a escolha do
// escopo e as mensagens que vão à interface são a lógica REAL de actions.ts.
vi.mock("next/navigation", () => ({ redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); }) }));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/identity", () => ({ requestIdentity: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ appPool: vi.fn(), dbOrigin: vi.fn() }));
vi.mock("@/lib/server/tenant-data", async (orig) => ({ ...(await orig<typeof import("@/lib/server/tenant-data")>()), resolveTenantContext: vi.fn() }));
vi.mock("@plataforma/api", async (orig) => ({ ...(await orig<typeof import("@plataforma/api")>()), runGeneration: vi.fn(), withTenant: vi.fn(), getPageDetail: vi.fn() }));

import * as api from "@plataforma/api";
import { resolveTenantContext } from "@/lib/server/tenant-data";
import { generateAction, reprocessAction } from "./actions";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POOL = { fake: "pool" } as never;
const ID = api.devIdentity([A]);
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const PAGE_ID = "22222222-2222-4222-8222-222222222222";
const ENTITY_ID = "33333333-3333-4333-8333-333333333333";
const mCtx = vi.mocked(resolveTenantContext);
const mRun = vi.mocked(api.runGeneration);
const mWith = vi.mocked(api.withTenant);
const mDetail = vi.mocked(api.getPageDetail);
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
const okCtx = () => mCtx.mockResolvedValue({ ok: true, pool: POOL, identity: ID, tenantId: A });
const ok = { runId: RUN_ID, status: "succeeded", total: 20, generated: 20, unchanged: 0, blocked: 0, items: [] } as never;

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(await reprocessAction(null, new FormData())).toEqual({ error: "Página não encontrada neste workspace." }); // sem pageId
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
