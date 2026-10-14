import { beforeEach, describe, expect, it, vi } from "vitest";

// Fronteiras mockadas: a resolução de sessão/tenant, a execução no banco (withTenant) e as ferramentas/leitor de packages/api. A validação, a escolha do
// contexto, o acúmulo de resultados e as mensagens são a lógica REAL de actions.ts e de action-context.ts.
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/identity", () => ({ requestIdentity: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ appPool: vi.fn(), dbOrigin: vi.fn() }));
vi.mock("@/lib/server/tenant-data", async (orig) => ({ ...(await orig<typeof import("@/lib/server/tenant-data")>()), resolveTenantContext: vi.fn() }));
vi.mock("@plataforma/api", async (orig) => {
  const real = await orig<typeof import("@plataforma/api")>();
  return { ...real, withTenant: vi.fn(), graph: { ...real.graph, createGraphReader: vi.fn(() => ({ fake: "reader" })), createSqlGraphStore: vi.fn(() => ({ fake: "store" })), runGraphTool: vi.fn() } };
});

import { notFound } from "next/navigation";
import { DynamicServerError } from "next/dist/client/components/hooks-server-context";
import * as api from "@plataforma/api";
import { resolveTenantContext } from "@/lib/server/tenant-data";
import { investigateAction, type InvestigateState } from "./actions";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const POOL = { fake: "pool" } as never;
const ID = api.devIdentity([A]);
const mCtx = vi.mocked(resolveTenantContext);
const mWith = vi.mocked(api.withTenant);
const mTool = vi.mocked(api.graph.runGraphTool);
const form = (f: Record<string, string>) => { const d = new FormData(); for (const [k, v] of Object.entries(f)) d.set(k, v); return d; };
const result = (n: number): api.graph.GraphToolResult => ({ tool: "describe_entity", ref: "uf:SP", ok: true, title: `r${n}`, steps: [], findings: [], citations: [], error: null });
const EMPTY: InvestigateState = { runs: [] };
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  mCtx.mockResolvedValue({ ok: true, pool: POOL, identity: ID, tenantId: A });
  mWith.mockImplementation(async (_p, _i, _t, fn) => fn({ query: vi.fn() } as never));
  mTool.mockResolvedValue(result(1));
});

describe("investigateAction: validação ANTES de qualquer efeito", () => {
  it("ferramenta desconhecida ou ausente: erro, e nem a sessão nem o banco são tocados", async () => {
    for (const tool of ["", "rm -rf", "describe_entity; DROP", "DESCRIBE_ENTITY", " describe_entity"]) {
      const r = await investigateAction(EMPTY, form({ tool, node: "uf:SP" }));
      expect(r.error, JSON.stringify(tool)).toBe("Ferramenta desconhecida.");
    }
    expect((await investigateAction(EMPTY, form({ node: "uf:SP" }))).error).toBe("Ferramenta desconhecida.");
    expect(mCtx).not.toHaveBeenCalled();
    expect(mWith).not.toHaveBeenCalled();
  });
  it("referência inválida (malformada, injeção, caminho): erro e nada é executado", async () => {
    for (const node of ["", "lixo", "uf:XX", "city:abc", "region:Leste", "page:1", "../../etc", "uf:SP'; DROP TABLE plataforma.city;--"]) {
      const r = await investigateAction(EMPTY, form({ tool: "describe_entity", node }));
      expect(r.error, JSON.stringify(node)).toBe("Referência de entidade inválida.");
    }
    expect(mCtx).not.toHaveBeenCalled();
    expect(mTool).not.toHaveBeenCalled();
  });
});

describe("investigateAction: execução", () => {
  it("válida: executa a ferramenta com o tenant e a identidade da SESSÃO, e acrescenta o resultado", async () => {
    const r = await investigateAction(EMPTY, form({ tool: "describe_entity", node: "uf:SP" }));
    expect(r).toEqual({ runs: [result(1)] });
    expect(mWith).toHaveBeenCalledExactlyOnceWith(POOL, ID, A, expect.any(Function));
    expect(mTool).toHaveBeenCalledExactlyOnceWith({ fake: "reader" }, "describe_entity", "uf:SP", expect.any(Date));
  });
  it("tenant e identidade enviados pelo cliente são IGNORADOS", async () => {
    await investigateAction(EMPTY, form({ tool: "trace_source", node: "uf:SP", tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", tenant_id: "x", userId: "y" }));
    expect(mWith.mock.calls[0]!.slice(0, 3)).toEqual([POOL, ID, A]);
  });
  it("acumula os resultados anteriores e mantém só os 6 mais recentes", async () => {
    let state: InvestigateState = EMPTY;
    for (let i = 1; i <= 8; i++) { mTool.mockResolvedValueOnce(result(i)); state = await investigateAction(state, form({ tool: "describe_entity", node: "uf:SP" })); }
    expect(state.runs.map((r) => r.title)).toEqual(["r3", "r4", "r5", "r6", "r7", "r8"]);
  });
  it("uma falha preserva os resultados já obtidos e mostra a mensagem (sem vazar a causa)", async () => {
    const prev: InvestigateState = { runs: [result(1)] };
    mWith.mockRejectedValueOnce(new Error("conexão: postgresql://u:SEGREDO@h/d"));
    const r = await investigateAction(prev, form({ tool: "describe_entity", node: "uf:SP" }));
    expect(r.runs).toEqual([result(1)]);
    expect(r.error).toMatch(/Não foi possível concluir agora/);
    expect(JSON.stringify(r)).not.toMatch(/SEGREDO|postgresql:/);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SEGREDO|postgresql:/);
  });
  it("banco indisponível, tabela ausente e sessão: mensagens próprias; tabela ausente não é registrada como falha", async () => {
    mWith.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ECONNREFUSED" }));
    expect((await investigateAction(EMPTY, form({ tool: "describe_entity", node: "uf:SP" }))).error).toMatch(/banco de dados não respondeu/);
    log.mockClear();
    mWith.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "42P01" }));
    expect((await investigateAction(EMPTY, form({ tool: "describe_entity", node: "uf:SP" }))).error).toMatch(/migrations precisam ser aplicadas/);
    expect(log).not.toHaveBeenCalled();
    for (const [ctx, msg] of [[{ ok: false, reason: "unauthenticated" }, /Sua sessão expirou/], [{ ok: false, reason: "no_tenant" }, /workspace/], [{ ok: false, reason: "not_configured", missing: "x" }, /não está configurada/]] as const) {
      mCtx.mockResolvedValueOnce(ctx);
      expect((await investigateAction(EMPTY, form({ tool: "describe_entity", node: "uf:SP" }))).error).toMatch(msg);
    }
    expect(mTool).not.toHaveBeenCalled();
  });
  it("falha inesperada ao verificar a sessão: mensagem clara; erros do framework Next.js são REPASSADOS", async () => {
    mCtx.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await investigateAction(EMPTY, form({ tool: "describe_entity", node: "uf:SP" }))).error).toMatch(/Não foi possível verificar sua sessão agora/);
    const framework = (() => { try { notFound(); } catch (e) { return e; } throw new Error("sem erro"); })();
    for (const err of [framework, new DynamicServerError("Dynamic server usage: cookies")]) {
      mCtx.mockRejectedValueOnce(err);
      await expect(investigateAction(EMPTY, form({ tool: "describe_entity", node: "uf:SP" }))).rejects.toBe(err);
    }
    expect(mWith).not.toHaveBeenCalled();
  });
  it("só leitura por construção: a ação não escreve nem publica (a API do grafo não oferece nenhuma função de escrita)", () => {
    expect(Object.keys(api.graph).filter((k) => /^(create|insert|update|delete|write|save|publish|approve)(?!.*(Reader|Store))/i.test(k))).toEqual([]);
  });
});
