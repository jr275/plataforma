import { beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  vi.clearAllMocks();
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
  it("contexto válido com UM único tenant autorizado: é ele, com a mesma identidade e o pool", async () => {
    const id = identity(A);
    mIdentity.mockResolvedValue({ state: "ok", identity: id });
    const ctx = await resolveTenantContext();
    expect(ctx).toEqual({ ok: true, pool: POOL, identity: id, tenantId: A });
  });
  it("VÁRIOS tenants sem seleção explícita: seleção obrigatória (nunca o primeiro), com as opções da claim, qualquer que seja a ordem", async () => {
    mIdentity.mockResolvedValue({ state: "ok", identity: identity(A, B) });
    expect(await resolveTenantContext()).toEqual({ ok: false, reason: "tenant_selection_required", choices: [A, B] });
    mIdentity.mockResolvedValue({ state: "ok", identity: identity(B, A) });
    expect(await resolveTenantContext()).toEqual({ ok: false, reason: "tenant_selection_required", choices: [B, A] });
    expect(mWith).not.toHaveBeenCalled();
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
    const id = identity(A);
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
    for (const err of [{ code: "22012" }, { code: "42501" }, { code: "ECONNREFUSED" }, { code: "08006" }, new Error("boom")]) {
      mWith.mockRejectedValueOnce(err);
      expect(await loadForTenant(vi.fn())).toEqual({ state: "error" });
    }
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

describe("seleção de tenant (F2): nada é lido nem escrito enquanto a seleção estiver ambígua", () => {
  it("loadForTenant com vários tenants: estado controlado com as opções; a consulta NÃO roda e withTenant NÃO é chamado", async () => {
    mIdentity.mockResolvedValue({ state: "ok", identity: identity(A, B) });
    const fn = vi.fn(async () => ({ n: 1 }));
    expect(await loadForTenant(fn)).toEqual({ state: "tenant_selection_required", choices: [A, B] });
    expect(fn).not.toHaveBeenCalled();
    expect(mWith).not.toHaveBeenCalled();
  });
});
