import { beforeEach, describe, expect, it, vi } from "vitest";

// Fronteiras mockadas: a sessão/tenant e as funções do motor (que têm testes de produto próprios em PostgreSQL real). A validação,
// o escopo (tenant só da sessão) e as mensagens que vão à interface são a lógica REAL de actions.ts.
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/lib/server/identity", () => ({ requestIdentity: vi.fn() }));
vi.mock("@/lib/server/db", () => ({ appPool: vi.fn(), dbOrigin: vi.fn() }));
vi.mock("@/lib/server/tenant-data", async (orig) => ({ ...(await orig<typeof import("@/lib/server/tenant-data")>()), resolveTenantContext: vi.fn() }));
vi.mock("@plataforma/api", async (orig) => {
  const real = await orig<typeof import("@plataforma/api")>();
  return { ...real, engine: { ...real.engine, runResearch: vi.fn(), transitionOpportunity: vi.fn(), rescoreOpportunity: vi.fn(), saveScoreConfig: vi.fn(), ensureActiveConfigFor: vi.fn(), createBlueprint: vi.fn(), applySerpWaiver: vi.fn() } };
});

import { TEMPLATE_REGISTRY, devIdentity, engine } from "@plataforma/api";
import { realEstateVertical } from "@plataforma/pack-real-estate";
import { resolveTenantContext } from "@/lib/server/tenant-data";
import { blueprintAction, serpWaiverAction, researchAction, rescoreAction, saveConfigAction, transitionAction } from "./actions";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPP = "11111111-1111-4111-8111-111111111111";
const POOL = { fake: "pool" } as never;
const mCtx = vi.mocked(resolveTenantContext);
const mRun = vi.mocked(engine.runResearch);
const mTr = vi.mocked(engine.transitionOpportunity);
const mRe = vi.mocked(engine.rescoreOpportunity);
const mSave = vi.mocked(engine.saveScoreConfig);
const mBp = vi.mocked(engine.createBlueprint);
const mWaiver = vi.mocked(engine.applySerpWaiver);
const mActive = vi.mocked(engine.ensureActiveConfigFor);
const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mCtx.mockResolvedValue({ ok: true, pool: POOL, identity: devIdentity([A]), tenantId: A });
});

describe("researchAction", () => {
  for (const bad of ["", "0", "101", "-1", "1.5", "2e1", "vinte", "1 0"]) {
    it(`entrada inválida (${JSON.stringify(bad)}): erro no campo e nada é consultado`, async () => {
      expect(await researchAction(null, form({ entities: bad }))).toEqual({ fieldError: "Informe um número inteiro de 1 a 100." });
      expect(mCtx).not.toHaveBeenCalled();
      expect(mRun).not.toHaveBeenCalled();
    });
  }
  it("usa só a sessão (tenant e identidade) e a vertical do servidor; ignora tenant vindo do formulário", async () => {
    mRun.mockResolvedValue({ runId: "r", status: "succeeded" } as never);
    const r = await researchAction(null, form({ entities: "20", tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", vertical: "outra" }));
    expect(r).toMatchObject({ result: { runId: "r" } });
    expect(mRun).toHaveBeenCalledOnce();
    const [pool, , tenantId, deps, input] = mRun.mock.calls[0]!;
    expect(pool).toBe(POOL);
    expect(tenantId).toBe(A);
    expect(deps.vertical.id).toBe(realEstateVertical.id);
    expect(deps.adapters.map((a) => a.id)).toEqual(["bcb-sgs", "ibge-news", "rss-news"]);
    expect(input).toEqual({ entityLimit: 20 });
  });
  it("pesquisa já em andamento vira mensagem clara; falha qualquer não vaza a mensagem do banco", async () => {
    mRun.mockRejectedValueOnce(new engine.ResearchBusyError("x"));
    expect(await researchAction(null, form({ entities: "5" }))).toEqual({ error: expect.stringContaining("em andamento") });
    mRun.mockRejectedValueOnce(new Error("password authentication failed for user menlo_app host db.interno"));
    const r = await researchAction(null, form({ entities: "5" }));
    expect(r?.error).toBeDefined();
    expect(JSON.stringify(r)).not.toMatch(/menlo_app|password|db\.interno/);
  });
  it("sem sessão: mensagem e nenhuma execução", async () => {
    mCtx.mockResolvedValueOnce({ ok: false, reason: "unauthenticated" });
    expect(await researchAction(null, form({ entities: "5" }))).toEqual({ error: "Sua sessão expirou. Entre novamente." });
    expect(mRun).not.toHaveBeenCalled();
  });
});

describe("transitionAction", () => {
  const ok = { opportunityId: OPP, from: "eligible", to: "retired", reason: "decisão do time" };
  for (const [nome, over] of [["id malformado", { opportunityId: "x" }], ["estado inexistente", { to: "aprovada" }], ["origem inexistente", { from: "x" }], ["motivo curto", { reason: "a" }], ["motivo ausente", { reason: "   " }]] as const) {
    it(`${nome}: recusa sem executar`, async () => {
      expect((await transitionAction(null, form({ ...ok, ...over })))?.error).toBeTruthy();
      expect(mTr).not.toHaveBeenCalled();
    });
  }
  it("transição válida: chama o motor com o tenant da sessão e confirma", async () => {
    mTr.mockResolvedValue(undefined);
    expect(await transitionAction(null, form(ok))).toEqual({ ok: expect.stringContaining("Aposentada") });
    expect(mTr).toHaveBeenCalledWith(POOL, expect.anything(), A, ok);
  });
  it("etapas que afirmam trabalho feito NÃO podem ser marcadas à mão (SERP, blueprint, publicação) e nada é executado", async () => {
    for (const [from, to] of [["eligible", "serp_analyzed"], ["eligible", "blueprinted"], ["qa", "published"], ["blueprinted", "data_assembled"]]) {
      const r = await transitionAction(null, form({ ...ok, from: from!, to: to! }));
      expect(r?.error, `${from}->${to}`).toContain("só é registrada pelo fluxo que a realiza");
    }
    expect(mTr).not.toHaveBeenCalled();
  });
  it("traduz os erros do ciclo de vida", async () => {
    mTr.mockRejectedValueOnce(new engine.LifecycleError("eligible", "published"));
    expect((await transitionAction(null, form(ok)))?.error).toContain("não é permitida");
    mTr.mockRejectedValueOnce(new engine.StaleStateError("eligible", "retired"));
    expect((await transitionAction(null, form(ok)))?.error).toContain("estado mudou");
    mTr.mockRejectedValueOnce(new engine.OpportunityNotFoundError());
    expect((await transitionAction(null, form(ok)))?.error).toContain("não encontrada");
  });
});

describe("rescoreAction", () => {
  it("valida o identificador e a versão antes de qualquer efeito", async () => {
    expect((await rescoreAction(null, form({ opportunityId: "x", configVersion: "1" })))?.error).toBeTruthy();
    expect((await rescoreAction(null, form({ opportunityId: OPP, configVersion: "0" })))?.error).toBeTruthy();
    expect((await rescoreAction(null, form({ opportunityId: OPP, configVersion: "1.5" })))?.error).toBeTruthy();
    expect(mRe).not.toHaveBeenCalled();
  });
  it("diferencia 'novo score' de 'já existia'", async () => {
    mRe.mockResolvedValueOnce({ created: true, configVersion: 2 } as never).mockResolvedValueOnce({ created: false, configVersion: 2 } as never);
    expect((await rescoreAction(null, form({ opportunityId: OPP, configVersion: "2" })))?.ok).toContain("Novo score");
    expect((await rescoreAction(null, form({ opportunityId: OPP, configVersion: "2" })))?.ok).toContain("nada mudou");
  });
});

describe("saveConfigAction", () => {
  const base = realEstateVertical.scoring;
  const fields = (over: Record<string, string> = {}) => {
    const f: Record<string, string> = { uncertaintyFactor: String(base.uncertaintyFactor), "elig.minCommercialValue": String(base.eligibility.minCommercialValue), "elig.minExecutionFeasibility": String(base.eligibility.minExecutionFeasibility), "elig.maxEvidenceRisk": String(base.eligibility.maxEvidenceRisk), "elig.maxCannibalizationRisk": String(base.eligibility.maxCannibalizationRisk) };
    for (const o of engine.OBJECTIVES) { f[`obj.${o}.weight`] = String(base.objectives[o].weight); f[`obj.${o}.minCoverage`] = String(base.objectives[o].minCoverage); for (const [d, w] of Object.entries(base.objectives[o].dimensions)) f[`dim.${o}.${d}`] = String(w); }
    return { ...f, ...over };
  };
  beforeEach(() => { mActive.mockResolvedValue({ id: "c", version: 1, hash: "h", config: base, note: null, createdAt: new Date() }); });
  it("campo não numérico ou negativo: erro POR CAMPO e nada é salvo", async () => {
    const r = await saveConfigAction(null, form(fields({ "obj.commercial_value.weight": "muito", "elig.minCommercialValue": "-3" })));
    expect(r?.fieldErrors).toMatchObject({ "obj.commercial_value.weight": expect.any(String), "elig.minCommercialValue": expect.any(String) });
    expect(mSave).not.toHaveBeenCalled();
  });
  it("configuração semanticamente inválida (cobertura fora de 0..1) é recusada pelo validador do motor", async () => {
    const r = await saveConfigAction(null, form(fields({ "obj.commercial_value.minCoverage": "1.7" })));
    expect(r?.error).toContain("inválida");
    expect(mSave).not.toHaveBeenCalled();
  });
  it("salva como nova versão, aceitando vírgula decimal e a marcação de elegibilidade", async () => {
    mSave.mockResolvedValue({ created: true, config: { version: 2 } } as never);
    const r = await saveConfigAction(null, form({ ...fields({ "elig.minCommercialValue": "42,5" }), "elig.requireStrategicOrDemand": "on", note: "mais rígido" }));
    expect(r?.ok).toContain("Versão 2");
    const arg = mSave.mock.calls[0]![3];
    expect(arg.config.eligibility.minCommercialValue).toBe(42.5);
    expect(arg.config.eligibility.requireStrategicOrDemand).toBe(true);
    expect(arg.verticalId).toBe(realEstateVertical.id);
    expect(arg.note).toBe("mais rígido");
  });
  it("mesmo conteúdo: diz que nada mudou", async () => {
    mSave.mockResolvedValue({ created: false, config: { version: 1 } } as never);
    expect((await saveConfigAction(null, form({ ...fields(), "elig.requireStrategicOrDemand": base.eligibility.requireStrategicOrDemand ? "on" : "" })))?.ok).toContain("Nada mudou");
  });
});

describe("blueprintAction", () => {
  const rec = (over: object = {}) => ({ created: true, transitioned: null, record: { version: 1, ready: false, report: { blockers: [{ key: "template:guide" }] } }, ...over }) as never;
  it("identificador inválido: recusa sem sessão nem efeito", async () => {
    expect(await blueprintAction(null, form({ opportunityId: "x" }))).toEqual({ error: "Identificador de oportunidade inválido." });
    expect(mCtx).not.toHaveBeenCalled();
    expect(mBp).not.toHaveBeenCalled();
  });
  it("usa só a sessão, a vertical do servidor e o registro de templates REAL do sistema", async () => {
    mBp.mockResolvedValue(rec());
    await blueprintAction(null, form({ opportunityId: OPP, tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
    const [pool, , tenantId, deps, input] = mBp.mock.calls[0]!;
    expect(pool).toBe(POOL);
    expect(tenantId).toBe(A);
    expect(deps.vertical.id).toBe(realEstateVertical.id);
    expect(deps.templates).toBe(TEMPLATE_REGISTRY);
    expect(input).toEqual({ opportunityId: OPP });
  });
  it("pronto sem avanço automático: a mensagem lembra que a SERP não foi analisada; bloqueado: diz quantos bloqueios; repetido: diz que nada mudou", async () => {
    mBp.mockResolvedValueOnce(rec({ record: { version: 1, ready: true, report: { blockers: [] } } }));
    expect((await blueprintAction(null, form({ opportunityId: OPP })))?.ok).toMatch(/pronto.*SERP não foi analisada.*exceção/);
    mBp.mockResolvedValueOnce(rec({ transitioned: { from: "serp_analyzed", serpWaived: false }, record: { version: 2, ready: true, report: { blockers: [] } } }));
    expect((await blueprintAction(null, form({ opportunityId: OPP })))?.ok).toMatch(/avançou para “Com blueprint”/);
    mBp.mockResolvedValueOnce(rec());
    expect((await blueprintAction(null, form({ opportunityId: OPP })))?.ok).toMatch(/1 bloqueio.*não avançou/);
    mBp.mockResolvedValueOnce(rec({ created: false }));
    expect((await blueprintAction(null, form({ opportunityId: OPP })))?.ok).toContain("Nada mudou");
  });
  it("traduz os erros", async () => {
    mBp.mockRejectedValueOnce(new engine.BlueprintStateError("scored"));
    expect((await blueprintAction(null, form({ opportunityId: OPP })))?.error).toContain("elegíveis");
    mBp.mockRejectedValueOnce(new engine.OpportunityNotFoundError());
    expect((await blueprintAction(null, form({ opportunityId: OPP })))?.error).toContain("não encontrada");
    mBp.mockRejectedValueOnce(new Error("connection to server at db.interno failed"));
    const r = await blueprintAction(null, form({ opportunityId: OPP }));
    expect(r?.error).toBeDefined();
    expect(JSON.stringify(r)).not.toContain("db.interno");
  });
});

describe("serpWaiverAction (exceção escrita da etapa SERP)", () => {
  const ok = { opportunityId: OPP, reason: "nenhum provedor de SERP contratado; revisar ao integrar", ack: "on" };
  for (const [nome, over, msg] of [["id malformado", { opportunityId: "x" }, "inválido"], ["motivo curto", { reason: "curto" }, "10 a 1000"], ["sem confirmação", { ack: "" }, "não autoriza publicação"]] as const) {
    it(`${nome}: recusa sem sessão nem efeito`, async () => {
      const r = await serpWaiverAction(null, form({ ...ok, ...over }));
      expect(r?.error).toContain(msg);
      expect(mCtx).not.toHaveBeenCalled();
      expect(mWaiver).not.toHaveBeenCalled();
    });
  }
  it("registra pela sessão (tenant e autor da identidade), só com motivo e confirmação, e diz que a exceção segue pendente de revisão", async () => {
    mWaiver.mockResolvedValue({ blueprintVersion: 3 });
    const r = await serpWaiverAction(null, form({ ...ok, tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
    expect(r?.ok).toMatch(/blueprint v3.*não avaliada.*pendente de revisão/);
    expect(mWaiver).toHaveBeenCalledWith(POOL, expect.anything(), A, { opportunityId: OPP, reason: ok.reason });
  });
  it("traduz os erros (blueprint não pronto, estado, outro tenant) e não vaza o banco", async () => {
    mWaiver.mockRejectedValueOnce(new engine.WaiverError("o blueprint mais recente tem gates reprovados: a exceção de SERP não resolve bloqueios"));
    expect((await serpWaiverAction(null, form(ok)))?.error).toContain("não resolve bloqueios");
    mWaiver.mockRejectedValueOnce(new engine.BlueprintStateError("scored"));
    expect((await serpWaiverAction(null, form(ok)))?.error).toContain("Elegível");
    mWaiver.mockRejectedValueOnce(new engine.OpportunityNotFoundError());
    expect((await serpWaiverAction(null, form(ok)))?.error).toContain("não encontrada");
    mWaiver.mockRejectedValueOnce(new Error("password authentication failed for user menlo_app"));
    expect(JSON.stringify(await serpWaiverAction(null, form(ok)))).not.toContain("menlo_app");
  });
});
