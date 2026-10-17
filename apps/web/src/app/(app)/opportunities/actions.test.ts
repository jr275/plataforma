import { beforeEach, describe, expect, it, vi } from "vitest";

// Fronteiras mockadas: cache do Next, a resolução de sessão/tenant e a execução no banco. A validação, a revalidação da transição contra o
// estado ATUAL e as mensagens que vão à interface são a lógica REAL de actions.ts.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/identity", () => ({ requestIdentity: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ appPool: vi.fn(), dbOrigin: vi.fn() }));
vi.mock("@/lib/server/tenant-data", async (orig) => ({ ...(await orig<typeof import("@/lib/server/tenant-data")>()), resolveTenantContext: vi.fn() }));
vi.mock("@plataforma/api", async (orig) => ({ ...(await orig<typeof import("@plataforma/api")>()), getOpportunity: vi.fn(), setOpportunityStatus: vi.fn(), withTenant: vi.fn() }));

import { revalidatePath } from "next/cache";
import * as api from "@plataforma/api";
import { resolveTenantContext } from "@/lib/server/tenant-data";
import { changeStatusAction } from "./actions";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPP = "44444444-4444-4444-8444-444444444444";
const POOL = { fake: "pool" } as never;
const ID = api.devIdentity([A]);
const mCtx = vi.mocked(resolveTenantContext);
const mGet = vi.mocked(api.getOpportunity);
const mSet = vi.mocked(api.setOpportunityStatus);
const mWith = vi.mocked(api.withTenant);
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
const current = (status: api.OpportunityStatus) => ({ id: OPP, tenantId: A, status }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mCtx.mockResolvedValue({ ok: true, pool: POOL, identity: ID, tenantId: A });
  mWith.mockImplementation(async (_p, _i, _t, fn) => fn({ query: vi.fn() } as never));
});

describe("changeStatusAction: validação ANTES de qualquer efeito", () => {
  for (const to of ["", "published", "READY", "ready'; DROP TABLE plataforma.opportunity;--"]) {
    it(`destino inválido (${JSON.stringify(to).slice(0, 30)}) é recusado sem tocar na sessão nem no banco`, async () => {
      expect(await changeStatusAction(null, form({ id: OPP, to }))).toEqual({ error: "Status de destino inválido." });
      expect(mCtx).not.toHaveBeenCalled();
      expect(mWith).not.toHaveBeenCalled();
    });
  }
});

describe("changeStatusAction: sessão e tenant vêm da sessão, nunca do formulário", () => {
  const cases: [string, RegExp][] = [
    ["unauthenticated", /sessão expirou/], ["no_tenant", /não está associado a um workspace/],
    ["tenant_selection_required", /mais de um workspace[\s\S]*nenhuma ação foi executada/], ["not_configured", /não está disponível neste ambiente/],
  ];
  for (const [reason, text] of cases) {
    it(`${reason}: mensagem própria e nenhuma escrita`, async () => {
      mCtx.mockResolvedValue({ ok: false, reason } as never);
      const r = await changeStatusAction(null, form({ id: OPP, to: "in_review" }));
      expect(r?.error).toMatch(text);
      expect(mWith).not.toHaveBeenCalled();
      expect(mSet).not.toHaveBeenCalled();
    });
  }
  it("um tenant enviado no formulário é ignorado: withTenant usa o da sessão", async () => {
    mGet.mockResolvedValue(current("candidate"));
    mSet.mockResolvedValue(current("in_review"));
    await changeStatusAction(null, form({ id: OPP, to: "in_review", tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
    expect(mWith).toHaveBeenCalledWith(POOL, ID, A, expect.any(Function));
  });
});

describe("changeStatusAction: a transição é revalidada contra o estado ATUAL", () => {
  it("transição válida: altera, revalida a lista e o detalhe", async () => {
    mGet.mockResolvedValue(current("candidate"));
    mSet.mockResolvedValue(current("in_review"));
    expect(await changeStatusAction(null, form({ id: OPP, to: "in_review" }))).toEqual({ done: "Status atualizado." });
    expect(mSet).toHaveBeenCalledWith(expect.anything(), OPP, "in_review");
    expect(revalidatePath).toHaveBeenCalledWith("/opportunities");
    expect(revalidatePath).toHaveBeenCalledWith(`/opportunities/${OPP}`);
  });
  it("transição não permitida (candidata → pronta): recusada, sem escrita e sem revalidar", async () => {
    mGet.mockResolvedValue(current("candidate"));
    const r = await changeStatusAction(null, form({ id: OPP, to: "ready" }));
    expect(r?.error).toMatch(/não é permitida/);
    expect(mSet).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("não dá para ir a 'blocked' por clique (o bloqueio vem dos gates)", async () => {
    mGet.mockResolvedValue(current("in_review"));
    expect((await changeStatusAction(null, form({ id: OPP, to: "blocked" })))?.error).toMatch(/não é permitida/);
    expect(mSet).not.toHaveBeenCalled();
  });
  it("já está nesse status: nada a alterar e nenhuma escrita", async () => {
    mGet.mockResolvedValue(current("ready"));
    expect((await changeStatusAction(null, form({ id: OPP, to: "ready" })))?.done).toMatch(/Nada a alterar/);
    expect(mSet).not.toHaveBeenCalled();
  });
  it("descartar e restaurar funcionam (sem DELETE: é só mudança de status)", async () => {
    mGet.mockResolvedValueOnce(current("in_review"));
    mSet.mockResolvedValueOnce(current("dismissed"));
    expect(await changeStatusAction(null, form({ id: OPP, to: "dismissed" }))).toEqual({ done: "Status atualizado." });
    mGet.mockResolvedValueOnce(current("dismissed"));
    mSet.mockResolvedValueOnce(current("candidate"));
    expect(await changeStatusAction(null, form({ id: OPP, to: "candidate" }))).toEqual({ done: "Status atualizado." });
  });
  it("oportunidade inexistente ou de outro tenant: o mesmo 'não encontrada', sem pista", async () => {
    mGet.mockResolvedValue(undefined);
    const r = await changeStatusAction(null, form({ id: OPP, to: "in_review" }));
    expect(r).toEqual({ error: "Oportunidade não encontrada neste workspace." });
    expect(mSet).not.toHaveBeenCalled();
  });
});

describe("changeStatusAction: falhas do banco viram mensagens, nunca o texto cru", () => {
  it("tabela inexistente (42P01) explica as migrations", async () => {
    mGet.mockRejectedValue(Object.assign(new Error('relation "plataforma.opportunity" does not exist'), { code: "42P01" }));
    expect((await changeStatusAction(null, form({ id: OPP, to: "in_review" })))?.error).toMatch(/migrations 0001 e 0002/);
  });
  it("erro qualquer: mensagem genérica sem vazar host, usuário ou SQL", async () => {
    mGet.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 user=menlo_app password=segredo"));
    const r = await changeStatusAction(null, form({ id: OPP, to: "in_review" }));
    expect(r?.error).toMatch(/Não foi possível alterar o status agora/);
    expect(JSON.stringify(r)).not.toMatch(/10\.0\.0\.5|menlo_app|segredo|ECONNREFUSED/);
  });
});
