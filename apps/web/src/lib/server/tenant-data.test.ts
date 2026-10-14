import { beforeEach, describe, expect, it, vi } from "vitest";
import { notFound, redirect } from "next/navigation";
import { DynamicServerError } from "next/dist/client/components/hooks-server-context";
import { makeDynamicHangingPromise } from "next/dist/server/dynamic-rendering-utils";
import { devIdentity } from "@plataforma/api";

// Fronteiras mockadas: a sessão (identity), o pool (db) e a execução no banco (withTenant). A lógica de resolver tenant e classificar
// estados é a REAL.
const callOrder: string[] = [];
vi.mock("next/server", () => ({ connection: vi.fn(async () => { callOrder.push("connection"); }) }));
vi.mock("@/lib/server/identity", () => ({ requestIdentity: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ appPool: vi.fn(), dbOrigin: vi.fn() }));
vi.mock("@plataforma/api", async (orig) => ({ ...(await orig<typeof import("@plataforma/api")>()), withTenant: vi.fn() }));

import * as api from "@plataforma/api";
import { appPool, dbOrigin } from "@/lib/server/db";
import { requestIdentity } from "@/lib/server/identity";
import { isNotMigrated, loadForTenant, resolveTenantContext } from "./tenant-data";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POOL = { fake: "pool" } as never;
const identity = (...tenants: string[]) => devIdentity(tenants);
const mIdentity = vi.mocked(requestIdentity);
const mPool = vi.mocked(appPool);
const mWith = vi.mocked(api.withTenant);

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  log = vi.spyOn(console, "error").mockImplementation(() => undefined); // o log interno não polui a saída; cada teste confere o que foi registrado
  callOrder.length = 0;
  mPool.mockReturnValue(POOL);
  vi.mocked(dbOrigin).mockReturnValue({ kind: "local", host: "socket local" });
});

describe("resolveTenantContext: a identidade verificada determina o escopo", () => {
  it("sem configuração do login: not_configured, sem tocar no pool", async () => {
    mIdentity.mockResolvedValue({ state: "not_configured" });
    expect(await resolveTenantContext()).toMatchObject({ ok: false, reason: "not_configured", missing: expect.stringMatching(/Supabase/) });
    expect(mPool).not.toHaveBeenCalled();
  });
  it("sem sessão (ou token inválido): unauthenticated, sem tocar no pool", async () => {
    mIdentity.mockResolvedValue({ state: "unauthenticated" });
    expect(await resolveTenantContext()).toEqual({ ok: false, reason: "unauthenticated" });
    expect(mPool).not.toHaveBeenCalled();
  });
  it("autenticado mas sem nenhum tenant autorizado: no_tenant", async () => {
    mIdentity.mockResolvedValue({ state: "ok", identity: identity() });
    expect(await resolveTenantContext()).toEqual({ ok: false, reason: "no_tenant" });
  });
  it("sem a variável do banco: not_configured, citando a variável", async () => {
    mIdentity.mockResolvedValue({ state: "ok", identity: identity(A) });
    mPool.mockReturnValue(null);
    expect(await resolveTenantContext()).toMatchObject({ ok: false, reason: "not_configured", missing: expect.stringContaining("PLATAFORMA_APP_DATABASE_URL") });
  });
  it("URL do banco inválida (o pool não pode ser criado): not_configured, e não uma falha de login", async () => {
    mIdentity.mockResolvedValue({ state: "ok", identity: identity(A) });
    mPool.mockImplementation(() => { throw new Error("URI inválida: postgresql://u:SEGREDO@h/d"); });
    const ctx = await resolveTenantContext();
    expect(ctx).toMatchObject({ ok: false, reason: "not_configured", missing: expect.stringContaining("PLATAFORMA_APP_DATABASE_URL") });
    expect(JSON.stringify(ctx)).not.toMatch(/SEGREDO|postgresql:/);
    expect(await loadForTenant(vi.fn())).toMatchObject({ state: "not_configured" });
  });
  it("contexto válido: tenant = o PRIMEIRO da claim verificada, com a mesma identidade e o pool", async () => {
    const id = identity(A, B);
    mIdentity.mockResolvedValue({ state: "ok", identity: id });
    const ctx = await resolveTenantContext();
    expect(ctx).toEqual({ ok: true, pool: POOL, identity: id, tenantId: A });
  });
  it("não aceita tenant vindo de fora: a função não tem parâmetros e ignora argumentos extras", async () => {
    expect(resolveTenantContext.length).toBe(0);
    mIdentity.mockResolvedValue({ state: "ok", identity: identity(A) });
    const ctx = await (resolveTenantContext as unknown as (x: unknown) => ReturnType<typeof resolveTenantContext>)({ tenantId: B });
    expect(ctx).toMatchObject({ ok: true, tenantId: A }); // tentativa de apontar para B é inócua
  });
  it("lê a sessão só em tempo de requisição (connection() antes da identidade)", async () => {
    mIdentity.mockImplementation(async () => { callOrder.push("identity"); return { state: "unauthenticated" }; });
    await resolveTenantContext();
    expect(callOrder).toEqual(["connection", "identity"]);
  });
  it("falha inesperada ao ler a sessão NÃO é engolida", async () => {
    mIdentity.mockRejectedValue(new Error("falha de rede ao buscar chaves"));
    await expect(resolveTenantContext()).rejects.toThrow(/falha de rede/);
  });
});

describe("loadForTenant: estados reais, sem vazar detalhes", () => {
  it("pronto: executa por withTenant com o pool, a identidade e o tenant da sessão, e informa a origem", async () => {
    const id = identity(A, B);
    mIdentity.mockResolvedValue({ state: "ok", identity: id });
    mWith.mockImplementation(async (_p, _i, _t, fn) => fn({ query: vi.fn() } as never));
    const fn = vi.fn(async () => ({ n: 7 }));
    const r = await loadForTenant(fn);
    expect(r).toEqual({ state: "ready", data: { n: 7 }, origin: { kind: "local", host: "socket local" } });
    expect(mWith).toHaveBeenCalledWith(POOL, id, A, expect.any(Function));
  });
  it("sem sessão, sem tenant e sem configuração: estados próprios e o banco nem é consultado", async () => {
    mIdentity.mockResolvedValue({ state: "unauthenticated" });
    expect(await loadForTenant(vi.fn())).toEqual({ state: "unauthenticated" });
    mIdentity.mockResolvedValue({ state: "ok", identity: identity() });
    expect(await loadForTenant(vi.fn())).toEqual({ state: "no_tenant" });
    mIdentity.mockResolvedValue({ state: "not_configured" });
    expect(await loadForTenant(vi.fn())).toMatchObject({ state: "not_configured", missing: expect.any(String) });
    expect(mWith).not.toHaveBeenCalled();
  });
  it("42P01 (direto ou em `cause`) vira not_migrated; qualquer outro erro vira `error` genérico", async () => {
    mIdentity.mockResolvedValue({ state: "ok", identity: identity(A) });
    mWith.mockRejectedValueOnce(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    expect(await loadForTenant(vi.fn())).toEqual({ state: "not_migrated" });
    mWith.mockRejectedValueOnce(new Error("embrulho", { cause: { code: "42P01" } }));
    expect(await loadForTenant(vi.fn())).toEqual({ state: "not_migrated" });
    for (const err of [{ code: "22012" }, { code: "42501" }, { code: "23505" }, new Error("boom")]) {
      mWith.mockRejectedValueOnce(err);
      expect(await loadForTenant(vi.fn())).toEqual({ state: "error" });
    }
  });
  it("banco indisponível (conexão recusada ou perdida, desligamento, timeout) é um estado PRÓPRIO, não o erro genérico", async () => {
    mIdentity.mockResolvedValue({ state: "ok", identity: identity(A) });
    for (const err of [{ code: "ECONNREFUSED" }, { code: "08006" }, { code: "57014" }, new Error("timeout exceeded when trying to connect"), new Error("embrulho", { cause: { code: "57P01" } })]) {
      mWith.mockRejectedValueOnce(err);
      expect(await loadForTenant(vi.fn())).toEqual({ state: "db_unavailable" });
    }
  });
  it("falha INESPERADA do provedor de login ao resolver o contexto: estado próprio, o banco nem é consultado e nada é engolido em silêncio (há log)", async () => {
    mIdentity.mockRejectedValue(new Error("falha ao buscar chaves em https://projeto.supabase.co/auth/v1/.well-known/jwks.json"));
    expect(await loadForTenant(vi.fn())).toEqual({ state: "auth_unavailable" });
    expect(mWith).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/supabase\.co|https?:/); // o log guarda o tipo e o código, nunca a mensagem
  });
  it("erros de infraestrutura e inesperados são REGISTRADOS no servidor com o código, sem mensagem nem segredo", async () => {
    mIdentity.mockResolvedValue({ state: "ok", identity: identity(A) });
    mWith.mockRejectedValueOnce(Object.assign(new Error("connection to postgresql://menlo_app:SEGREDO@h/d failed"), { code: "08006" }));
    await loadForTenant(vi.fn());
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).toContain("08006");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SEGREDO|postgresql:/);
  });
  it("tabela ausente NÃO é registrada como erro (é um estado esperado, migrations pendentes)", async () => {
    mIdentity.mockResolvedValue({ state: "ok", identity: identity(A) });
    mWith.mockRejectedValueOnce({ code: "42P01" });
    await loadForTenant(vi.fn());
    expect(log).not.toHaveBeenCalled();
  });
  it("o estado de erro não carrega a mensagem do banco (host, usuário ou senha)", async () => {
    mIdentity.mockResolvedValue({ state: "ok", identity: identity(A) });
    mWith.mockRejectedValue(new Error("connection to postgresql://menlo_app:SEGREDO@ep-x.neon.tech/db failed"));
    const r = await loadForTenant(vi.fn());
    expect(JSON.stringify(r)).not.toMatch(/SEGREDO|neon\.tech|menlo_app|postgresql:/);
  });
  it("isNotMigrated é a mesma classificação de packages/api (só 42P01)", () => {
    expect(isNotMigrated({ code: "42P01" })).toBe(true);
    expect(isNotMigrated({ code: "22012" })).toBe(false);
    expect(isNotMigrated(undefined)).toBe(false);
  });
});

// Erros de CONTROLE DE FLUXO do Next.js (documentação: unstable_rethrow). São os erros REAIS do framework, gerados pelas próprias funções dele
// (nada de imitação): quem captura exceções ao redor de cookies()/connection() precisa repassá-los, ou a renderização/redirecionamento quebra.
function realError(make: () => unknown): unknown { try { make(); } catch (e) { return e; } throw new Error("a função do framework não lançou"); }
async function hangingRejection(): Promise<unknown> {
  const ac = new AbortController();
  const p = makeDynamicHangingPromise(ac.signal, "/generation", "`connection()`");
  const out = p.then(() => undefined, (e: unknown) => e);
  ac.abort();
  return out;
}
const frameworkErrors: [string, () => Promise<unknown> | unknown][] = [
  ["redirect()", () => realError(() => redirect("/login"))],
  ["notFound()", () => realError(() => notFound())],
  ["DynamicServerError (recurso de requisição durante a pré-renderização)", () => new DynamicServerError("Dynamic server usage: cookies")],
  ["rejeição da promessa pendente do prerender (connection() abortado)", hangingRejection],
];

describe("loadForTenant: erros do framework Next.js NÃO viram estado de falha", () => {
  for (const [nome, make] of frameworkErrors) {
    it(`${nome}: é repassado intacto; nada é consultado nem registrado como falha`, async () => {
      const err = await make();
      expect(err).toBeInstanceOf(Error);
      mIdentity.mockRejectedValue(err);
      await expect(loadForTenant(vi.fn())).rejects.toBe(err);
      expect(mWith).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });
  }
  it("erro do framework embrulhado em `cause` também é repassado (o framework recebe o erro INTERNO dele, como unstable_rethrow faz)", async () => {
    const inner = realError(() => redirect("/login"));
    mIdentity.mockRejectedValue(new Error("embrulho", { cause: inner }));
    await expect(loadForTenant(vi.fn())).rejects.toBe(inner);
    expect(log).not.toHaveBeenCalled();
  });
  it("controle: uma falha comum do provedor de login CONTINUA virando auth_unavailable (o tratamento específico foi preservado)", async () => {
    mIdentity.mockRejectedValue(new TypeError("fetch failed"));
    expect(await loadForTenant(vi.fn())).toEqual({ state: "auth_unavailable" });
    expect(log).toHaveBeenCalledOnce();
  });
});
