import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb, devIdentity, runCityImport, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";
import { realEstateCatalog, realEstateFactConfidence } from "../../../../packs/real-estate/src/attributes";
import { realEstateTopicPatterns } from "../../../../packs/real-estate/src/topic-patterns";
import { realEstateVertical } from "../../../../packs/real-estate/src/vertical";
import { DEFAULT_ELIGIBILITY_POLICY } from "../../../../packs/real-estate/src/eligibility";
import { AGENT_HEADER, AGENT_PROMPTS, AGENT_PROMPTS_SOURCE, AGENT_PROMPT_VERSION } from "../../../../packs/real-estate/src/agent-prompts.generated";
import { materializeCities } from "../catalog";
import { runTopicGeneration } from "../topics";
import { listLatestDecisions, runEvaluation } from "../eligibility";
import { PUBLIC_UA, RateGate, RunBudget } from "../provider";
import { explainDecision, getExplanation, modelIntents, proposeTopics, reviewCombinations, summarizeInventory, writeBlueprintFields, type AgentBase, type AgentCtx, type DecisionInput, type IntentInput } from "./index";
import { scriptedLlm, type ScriptedCall } from "./test-support";

// Agentes contra o esquema REAL (migration 0017). O "LLM" é ROTEIRIZADO (test-support): prova o runner, a validação do código e a auditoria, NÃO a qualidade de um modelo real. Tenants G (fd7) e H (fd8).
const G = "fd777777-7777-4777-8777-777777777777";
const H = "fd888888-8888-4888-8888-888888888888";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const T0 = new Date("2026-10-14T12:00:00Z");
const PROMPTS = { version: AGENT_PROMPT_VERSION, sourceSha256: AGENT_PROMPTS_SOURCE.sha256, header: AGENT_HEADER, agents: Object.fromEntries(Object.entries(AGENT_PROMPTS).map(([k, v]) => [k, { name: v.name, body: v.body }])) };
const VARS = { TENANT_NAME: "Tenant de teste", DOMAIN_PACK: "real-estate", SCORE_BRAND: "Índice do tenant", EDITORIAL_STYLE: "direto", RICH_MIN: "0.8", MAX_PROPOSALS: "5", SCOPE: "SP" };
let pool: pg.Pool;
const id = () => devIdentity([G, H]);
const as = <X>(t: string, fn: (db: TenantDb) => Promise<X>) => withTenant(pool, id(), t, fn);
const count = (t: string, table: string, where = "true") => as(t, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${table} WHERE ${where}`)).rows[0]!.n));
const ctx = (script: Parameters<typeof scriptedLlm>[0], env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: "sk-ant-ficticia" }, calls: ScriptedCall[] = []): AgentCtx => ({ fetch: scriptedLlm(script, calls), userAgent: PUBLIC_UA, gate: new RateGate({}), env, prompts: PROMPTS, vars: VARS });
const base = (db: TenantDb): AgentBase => ({ db, budget: RunBudget.create(), runId: null, actor: "teste", now: () => T0 });
let decisionId = ""; let decision: DecisionInput; let topicId = "";

beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4)); pool.on("error", () => undefined);
  await runCityImport(pool, id(), G, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
  await as(G, (db) => materializeCities(db, realEstateFactConfidence, T0));
  await runTopicGeneration(pool, id(), G, { vertical: realEstateVertical, catalog: realEstateCatalog, patterns: realEstateTopicPatterns, now: () => T0 });
  await runEvaluation(pool, id(), G, { verticalId: realEstateVertical.id, attributes: realEstateCatalog.attributes, defaultPolicy: DEFAULT_ELIGIBILITY_POLICY, now: () => T0 });
  const d = (await as(G, (db) => listLatestDecisions(db, { limit: 1 }))).rows[0]!;
  decisionId = d.id; topicId = d.topicId;
  decision = { topic_id: d.topicId, decision: d.decision, eligible: d.eligible, gate_results: d.gateResults, gate_details: Object.fromEntries(Object.entries(d.gateDetails).map(([k, v]) => [k, { result: v.result, detail: v.detail, missing: v.missing }])), blocking_reasons: d.blockingReasons, missing_requirements: d.missingRequirements, floor_failures: [], total_score: d.totalScore, weight_coverage: d.weightCoverage, recommended_action: d.recommendedAction, policy_version: d.policyVersion };
});
afterAll(async () => { await pool.end(); });

describe("prompts: o arquivo lido por inteiro, versionado, sem placeholders crus", () => {
  it("os 8 agentes e o cabeçalho existem; a versão é derivada do sha do arquivo", () => {
    expect(Object.keys(AGENT_PROMPTS)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(AGENT_PROMPT_VERSION).toBe(`prompts-${AGENT_PROMPTS_SOURCE.sha256.slice(0, 12)}`);
    expect(AGENT_HEADER).toContain("Nunca proponha, descreva ou redija uma página apenas porque uma combinação");
  });
});

describe("sem ANTHROPIC_API_KEY: estado explícito, auditado, nada inventado", () => {
  it("provider_not_configured, com agent_run 'not_configured' guardando a entrada e nenhuma chamada ao provedor", async () => {
    const calls: ScriptedCall[] = [];
    const r = await as(G, (db) => explainDecision(ctx([], {}, calls), base(db), decisionId, decision));
    expect(r).toMatchObject({ state: "provider_not_configured", missing: ["ANTHROPIC_API_KEY"] });
    expect(calls).toHaveLength(0);
    const row = await as(G, async (db) => (await db.query<{ status: string; attempts: number; output: unknown; agent: number; prompt_version: string; input: { topic_id: string } }>(`SELECT status, attempts, output, agent, prompt_version, input FROM plataforma.agent_run WHERE id = $1`, [(r as unknown as { agentRunId: string }).agentRunId])).rows[0]!);
    expect(row).toMatchObject({ status: "not_configured", attempts: 0, output: null, agent: 5, prompt_version: AGENT_PROMPT_VERSION });
    expect(row.input.topic_id).toBe(topicId);
    expect(await as(G, (db) => getExplanation(db, decisionId))).toBeNull();
  });
});

describe("Agente 5: explica, não altera", () => {
  const good = (t: string) => JSON.stringify({ topic_id: t, explanation: "A decisão é DATA_REQUIRED: o gate de unicidade reprovou. Faltam blocos de dados que variem entre os municípios. A principal incerteza é a demanda, ainda sem fonte.", next_best_action: "Obter mais blocos de dados por município." });
  it("saída válida: grava a explicação ligada à decisão, o audit (prompt, modelo, tokens) e NÃO toca a decisão", async () => {
    const before = await as(G, (db) => listLatestDecisions(db, { limit: 1 }));
    const calls: ScriptedCall[] = [];
    const r = await as(G, (db) => explainDecision(ctx([good(topicId)], undefined, calls), base(db), decisionId, decision));
    expect(r).toMatchObject({ state: "ok", attempts: 1 });
    expect(calls[0]!.headers["x-api-key"]).toBe("sk-ant-ficticia");
    expect(calls[0]!.body.system).toContain("Tenant de teste");
    expect(calls[0]!.body.system).not.toContain("{{");
    expect(calls[0]!.body.messages[0]!.content).toContain(topicId); // o INPUT foi inserido
    expect(calls[0]!.body.messages[0]!.content).not.toContain("{{");
    expect(await as(G, (db) => getExplanation(db, decisionId))).toMatchObject({ explanation: expect.stringContaining("DATA_REQUIRED") });
    const run = await as(G, async (db) => (await db.query<{ status: string; attempts: number; model: string; prompt_version: string; prompt_sha256: string; usage: { inputTokens: number; outputTokens: number }; subject_kind: string; subject_ref: string; output: { topic_id: string } }>(`SELECT * FROM plataforma.agent_run WHERE id = $1`, [(r as unknown as { agentRunId: string }).agentRunId])).rows[0]!);
    expect(run).toMatchObject({ status: "succeeded", attempts: 1, model: "claude-sonnet-5-5", prompt_version: AGENT_PROMPT_VERSION, subject_kind: "decision", subject_ref: decisionId });
    expect(run.prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(run.usage.inputTokens).toBeGreaterThan(0);
    const after = await as(G, (db) => listLatestDecisions(db, { limit: 1 }));
    expect(after.rows[0]).toMatchObject({ id: before.rows[0]!.id, decision: before.rows[0]!.decision, totalScore: before.rows[0]!.totalScore });
    expect(await count(G, "eligibility_decision", `id = '${decisionId}' AND decision = '${decision.decision}'`)).toBe(1);
  });
  it("explicação que cita OUTRA decisão ou sugere prontidão é rejeitada; o agente corrige na nova tentativa (máx. 2 retentativas)", async () => {
    const bad = JSON.stringify({ topic_id: topicId, explanation: "A decisão é READY_FOR_BLUEPRINT e a página está pronta para publicação.", next_best_action: "Publicar." });
    const calls: ScriptedCall[] = [];
    const d2 = (await as(G, (db) => listLatestDecisions(db, { limit: 2 }))).rows[1]!;
    const dec2 = { ...decision, topic_id: d2.topicId };
    const r = await as(G, (db) => explainDecision(ctx([bad, good(d2.topicId)], undefined, calls), base(db), d2.id, dec2));
    expect(r).toMatchObject({ state: "ok", attempts: 2 });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(calls[1]!.body.messages[1]!.content).toContain("READY_FOR_BLUEPRINT");
    expect(calls[1]!.body.messages[2]!.content).toMatch(/Sua saída anterior foi inválida.*outra decisão/);
    const run = await as(G, async (db) => (await db.query<{ attempts: number; errors: string[] }>(`SELECT attempts, errors FROM plataforma.agent_run WHERE id = $1`, [(r as unknown as { agentRunId: string }).agentRunId])).rows[0]!);
    expect(run.attempts).toBe(2);
    expect(run.errors).toHaveLength(1);
  });
  it("3 saídas inválidas = falha EXPLÍCITA: nenhuma explicação gravada, agent_run 'invalid_output' com os 3 erros, decisão intacta", async () => {
    const d3 = (await as(G, (db) => listLatestDecisions(db, { limit: 3 }))).rows[2]!;
    const garbage = ["não é JSON", '{"topic_id": "x"}', JSON.stringify({ topic_id: d3.topicId, explanation: "uma. duas. três. quatro. cinco.", next_best_action: "a" })];
    const r = await as(G, (db) => explainDecision(ctx(garbage), base(db), d3.id, { ...decision, topic_id: d3.topicId }));
    expect(r).toMatchObject({ state: "failed", attempts: 3 });
    expect((r as unknown as { errors: string[] }).errors).toHaveLength(3);
    expect((r as unknown as { errors: string[] }).errors[2]).toMatch(/mais de 4 frases/);
    expect(await as(G, (db) => getExplanation(db, d3.id))).toBeNull();
    const run = await as(G, async (db) => (await db.query<{ status: string; output: unknown }>(`SELECT status, output FROM plataforma.agent_run WHERE id = $1`, [(r as unknown as { agentRunId: string }).agentRunId])).rows[0]!);
    expect(run).toMatchObject({ status: "invalid_output", output: null });
  });
  it("erro de transporte (HTTP 401) não é retentado e vira falha registrada", async () => {
    const d4 = (await as(G, (db) => listLatestDecisions(db, { limit: 4 }))).rows[3]!;
    const r = await as(G, (db) => explainDecision(ctx([{ status: 401, body: '{"error":"x"}' }]), base(db), d4.id, { ...decision, topic_id: d4.topicId }));
    expect(r).toMatchObject({ state: "failed", attempts: 1 });
    expect((r as unknown as { errors: string[] }).errors[0]).toContain("unauthorized");
  });
});

describe("Agente 3: a demanda vem do INPUT, nunca do agente", () => {
  const topics = async () => (await as(G, async (db) => (await db.query<{ topic_id: string; dimensions: Record<string, string>; primary_query: string; user_need: string }>(`SELECT topic_id, dimensions, primary_query, user_need FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL ORDER BY topic_id LIMIT 2`)).rows));
  const mkInput = async (demand: IntentInput["demand_data"]): Promise<IntentInput> => ({ topics: (await topics()).map((t) => ({ topic_id: t.topic_id, dimensions: t.dimensions, query_hypothesis: t.primary_query, user_need: t.user_need })), demand_data: demand, existing_pages: [] });
  const out = (ids: string[], over: Record<string, unknown> = {}) => JSON.stringify({ intents: ids.map((tid) => ({ topic_id: tid, what: "dados do município", where: "município", why: "entender o tamanho", when: "não sazonal", for_whom: "quem pesquisa onde morar", intent_type: "informational", primary_keyword: null, variants: [], query_hypothesis: "população do município", demand_status: "HYPOTHESIS", demand_signal: { value: null, source: "", period: "", uncertainty: "sem sinal" }, unmet_need: false, ...over })) });
  it("sem consulta no INPUT: primary_keyword null e HYPOTHESIS; grava o modelo de intenção no tópico", async () => {
    const input = await mkInput([]);
    const ids = input.topics.map((t) => t.topic_id);
    const r = await as(G, (db) => modelIntents(ctx([out(ids)]), base(db), input));
    expect(r.state).toBe("ok");
    expect(r.intents![0]).toMatchObject({ demandStatus: "HYPOTHESIS", primaryKeyword: null, demandSignal: { value: null }, discrepancies: [] });
    const m = await as(G, async (db) => (await db.query<{ intent_model: { demandStatus: string; agentRunId: string } }>(`SELECT intent_model FROM plataforma.growth_opportunity WHERE topic_id = $1`, [ids[0]])).rows[0]!.intent_model);
    expect(m).toMatchObject({ demandStatus: "HYPOTHESIS" });
    expect(m.agentRunId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("keyword inventada (fora de INPUT.demand_data) é rejeitada e o agente é obrigado a usar null", async () => {
    const input = await mkInput([{ query: "consulta sem relação", value: null, impressions: 3, source: "teste", period: "30d", method: "contagem" }]); const ids = input.topics.map((t) => t.topic_id); // entrada diferente da anterior: o cache determinístico não a reaproveita
    const calls: ScriptedCall[] = [];
    const r = await as(G, (db) => modelIntents(ctx([out(ids, { primary_keyword: "apartamento barato sp", demand_status: "OBSERVED" }), out(ids)], undefined, calls), base(db), input));
    expect(r).toMatchObject({ state: "ok", attempts: 2 });
    expect(calls[1]!.body.messages[2]!.content).toMatch(/primary_keyword não está em INPUT\.demand_data/);
  });
  it("o código SOBRESCREVE o sinal de demanda e a necessidade não atendida; divergência do agente fica registrada", async () => {
    const input = await mkInput([{ query: "população de são paulo", value: 4400, impressions: 900, source: "Search Console (teste)", period: "12m", method: "estimativa" }]);
    const ids = input.topics.map((t) => t.topic_id);
    const r = await as(G, (db) => modelIntents(ctx([out(ids, { primary_keyword: "população de são paulo", variants: [], demand_status: "OBSERVED", demand_signal: { value: 999999, source: "inventado", period: "x", uncertainty: "nenhuma" }, unmet_need: false })]), base(db), input));
    expect(r.state).toBe("ok");
    const i = r.intents![0]!;
    expect(i).toMatchObject({ demandStatus: "OBSERVED", primaryKeyword: "população de são paulo", demandSignal: { value: 4400, source: "Search Console (teste)", period: "12m" }, unmetNeed: true });
    expect(i.discrepancies.join()).toMatch(/valor de demanda do agente \(999999\) diverge do INPUT \(4400\)/);
    expect(i.discrepancies.join()).toMatch(/unmet_need/);
  });
});

describe("Agente 6: campos semânticos do blueprint", () => {
  const draft = { page_id: "p1", fill: ["topic_definition", "title_pattern", "h1_pattern", "meta_description_pattern", "target_query_cluster.secondary"], data_contract: [{ module_id: "m1", fields: ["city_name", "population"] }], intent: { variants: ["população de {x}"] }, related_pages: [], sample_values: { city_name: "São Paulo", population: "11.451.999" } };
  const ok = JSON.stringify({ page_id: "p1", fields: { topic_definition: "Qual o tamanho do município e onde fica, para quem pesquisa onde morar.", title_pattern: "{city_name}: população e dados", h1_pattern: "{city_name}", meta_description_pattern: "Dados verificáveis de {city_name}, com população e localização.", "target_query_cluster.secondary": [] }, notes: "" });
  it("campos válidos passam; título com placeholder inexistente, longo demais ou campo não pedido são rejeitados com motivo", async () => {
    const calls: ScriptedCall[] = [];
    const badOut = JSON.stringify({ page_id: "p1", fields: { title_pattern: "{inexistente}: " + "x".repeat(70), extra_field: "x" }, notes: "" });
    const r = await as(G, (db) => writeBlueprintFields(ctx([badOut, ok], undefined, calls), base(db), draft));
    expect(r).toMatchObject({ state: "ok", attempts: 2 });
    const fb = calls[1]!.body.messages[2]!.content;
    expect(fb).toMatch(/campo não pedido \(__FILL__\): extra_field/);
    expect(fb).toMatch(/placeholder \{inexistente\} não existe em data_contract/);
    expect(fb).toMatch(/caracteres com valores típicos \(máximo 60\)/);
  });
});

describe("Agentes 1, 2 e 4: o código valida", () => {
  it("Agente 1 não pode alterar números do INPUT nem inventar atributos; ordem por topics_unblocked", async () => {
    const input = { scope: "SP", richMin: 0.8, entities: [{ entity_id: "e1", name: "São Paulo" }], attributes: [{ attribute_id: "city.population", entity_type: "city", family: "M", status: "VALID", coverage: 1, freshness_days: 10, confidence: 0.9, topics_unblocked: 5 }, { attribute_id: "city.uf", entity_type: "city", family: "M", status: "VALID", coverage: 1, freshness_days: 10, confidence: 0.9, topics_unblocked: 2 }] };
    const gap = (a: string, n: number) => ({ attribute_id: a, family: "M", topics_unblocked: n, collection_cost: "low", suggested_source_class: "IBGE", rationale: "x" });
    const bad = JSON.stringify({ scope: "SP", entities: [{ entity_id: "e1", name: "São Paulo", families: { M: "RICH" } }], top_gaps: [gap("city.population", 9), gap("city.ghost", 1)] });
    const good = JSON.stringify({ scope: "SP", entities: [{ entity_id: "e1", name: "São Paulo", families: { M: "RICH" } }], top_gaps: [gap("city.population", 5), gap("city.uf", 2)] });
    const calls: ScriptedCall[] = [];
    const r = await as(G, (db) => summarizeInventory(ctx([bad, good], undefined, calls), base(db), input));
    expect(r).toMatchObject({ state: "ok", attempts: 2 });
    expect(calls[1]!.body.messages[2]!.content).toMatch(/números do INPUT não podem mudar/);
    expect(calls[1]!.body.messages[2]!.content).toMatch(/atributo que não está no INPUT: city\.ghost/);
  });
  it("Agente 2: cada proposta é validada individualmente; as inválidas são descartadas com motivo (não falham a execução)", async () => {
    const prop = (o: Record<string, unknown>) => ({ dimensions: { topic: "ranking" }, attributes_used: ["city.population"], relationships_used: ["located_in"], candidate_page_family: "04-cidade", user_need: "x", query_hypothesis: "q", why_not_covered: "w", evidence_required: [], ...o });
    const out = JSON.stringify({ proposals: [prop({}), prop({ attributes_used: ["city.ghost"] }), prop({ candidate_page_family: "ZZ" })] });
    const entity = { id: "e1", entityType: "city", sourceKey: "ibge:1", name: "X", qualifier: "SP" };
    const r = await as(G, (db) => proposeTopics(ctx([out]), base(db), { entity: { entity_id: "e1", name: "X" }, attributes: [], relationships: [], existing_topics: [], compatibility: [] }, { entity, catalogStatus: new Map([["city.population", "VALID"]]), relationships: new Set(["located_in"]), families: new Set(["04-cidade"]), dimensionIds: new Set(["topic"]), existingTopicIds: new Set(), tenantId: G, compatible: () => null }));
    expect(r.state).toBe("ok");
    expect(r.accepted).toHaveLength(1);
    expect(r.discarded!.map((d) => d.reasons.join())).toEqual([expect.stringContaining("atributo inexistente no catálogo: city.ghost"), expect.stringContaining("família de página desconhecida")]);
  });
  it("Agente 4: toda revisão referencia filhos do INPUT e todo filho precisa de revisão", async () => {
    const input = { groups: [{ parent: { topic_id: "p", dimensions: {} }, children: [{ topic_id: "c1", dimensions: {}, count: 3, exclusive_blocks: 1 }, { topic_id: "c2", dimensions: {}, count: 2, exclusive_blocks: 1 }] }] };
    const rv = (id: string) => ({ topic_id: id, differs_from_parent: true, parent_reason: "x", redundant_with_siblings: [], recommendation: "KEEP_AS_PAGE", rationale: "y" });
    const calls: ScriptedCall[] = [];
    const r = await as(G, (db) => reviewCombinations(ctx([JSON.stringify({ reviews: [rv("c1"), rv("zz")] }), JSON.stringify({ reviews: [rv("c1"), rv("c2")] })], undefined, calls), base(db), input));
    expect(r).toMatchObject({ state: "ok", attempts: 2 });
    expect(calls[1]!.body.messages[2]!.content).toMatch(/topic_id fora do INPUT: zz/);
    expect(calls[1]!.body.messages[2]!.content).toMatch(/filho sem revisão: c2/);
  });
});

describe("auditoria e isolamento", () => {
  it("o outro tenant não vê execuções nem explicações; a auditoria é imutável", async () => {
    expect(await count(H, "agent_run")).toBe(0);
    expect(await count(H, "decision_explanation")).toBe(0);
    expect(await count(G, "agent_run")).toBeGreaterThan(8);
    await expect(as(G, (db) => db.query(`UPDATE plataforma.agent_run SET status = 'succeeded'`))).rejects.toThrow(/permission denied/);
    await expect(as(G, (db) => db.query(`DELETE FROM plataforma.decision_explanation`))).rejects.toThrow(/permission denied/);
  });
  it("o banco recusa 'succeeded' sem saída e 'not_configured' com tentativas", async () => {
    const ins = (status: string, attempts: number, output: string | null) => as(G, (db) => db.query(`INSERT INTO plataforma.agent_run (tenant_id, agent, agent_name, prompt_version, prompt_sha256, model, status, attempts, input, output, created_by) VALUES (plataforma.current_tenant_id(), 5, 'x', 'v', $1, 'm', $2, $3, '{}', $4::jsonb, 't')`, ["a".repeat(64), status, attempts, output]));
    await expect(ins("succeeded", 1, null)).rejects.toThrow(/check constraint/);
    await expect(ins("not_configured", 2, null)).rejects.toThrow(/check constraint/);
  });
});
