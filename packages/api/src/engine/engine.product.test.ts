import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEMPLATE_REGISTRY, TenantDb, devIdentity, runCityImport, withTenant } from "../index";
import { productPoolConfig } from "../testing/pool-config";
import { realEstateVertical } from "../../../../packs/real-estate/src/vertical";
import { fakeFetch, fixture, type Route } from "./test-support/fake-fetch";
import { STATES, TRANSITIONS, bcbSgsAdapter, ibgeNewsAdapter, rssNewsAdapter, ResearchBusyError, StaleStateError, OpportunityNotFoundError, ConfigError, LifecycleError, getOpportunity, listResearchRuns, rescoreOpportunity, runResearch, saveScoreConfig, searchEvidence, searchOpportunities, transitionOpportunity, ensureActiveConfig, listScoreConfigs, recoverStaleResearchRuns, WaiverError, applySerpWaiver, findSerpWaiver, BlueprintStateError, createBlueprint, listBlueprints, loadRoadmap, GATE_IDS } from "./index";

// Motor de oportunidades contra o esquema REAL (migrations 0001 a 0008) num PostgreSQL descartável. Entidades: extrato real do IBGE (SP, 645 municípios).
// Fontes: respostas REAIS capturadas em 2026-10-13 (BCB, IBGE, Agência Brasil), servidas por um `fetch` de teste; nada é inventado. Tenants exclusivos P e Q.
const P = "fb111111-1111-4111-8111-111111111111";
const Q = "fb222222-2222-4222-8222-222222222222";
const R = "fb333333-3333-4333-8333-333333333333";
const FIXTURE = readFileSync(new URL("../../../../db/test-fixtures/generation/sp-ibge-2026-10-12.csv", import.meta.url));
const MAPPING = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const NOW = new Date("2026-10-13T15:00:00Z");
const FEED = "https://agenciabrasil.ebc.com.br/rss/economia/feed.xml";
const OK: Record<string, Route> = {
  "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/": { body: fixture("bcb-432.json") },
  "https://api.bcb.gov.br/dados/serie/bcdata.sgs.13522/": { body: fixture("bcb-13522.json") },
  "https://api.bcb.gov.br/dados/serie/bcdata.sgs.189/": { body: fixture("bcb-189.json") },
  "https://servicodados.ibge.gov.br/api/v3/noticias/": { body: fixture("ibge-news.json") },
  "https://agenciabrasil.ebc.com.br/robots.txt": { body: fixture("agenciabrasil-robots.txt") },
  [FEED]: { body: fixture("agenciabrasil-economia.xml") },
};
const deps = (routes: Record<string, Route> = OK) => ({ vertical: realEstateVertical, adapters: [bcbSgsAdapter, ibgeNewsAdapter, rssNewsAdapter], fetch: fakeFetch(routes), now: () => NOW, sleep: async () => undefined });

let pool: pg.Pool;
beforeAll(async () => {
  pool = new pg.Pool(productPoolConfig(4));
  pool.on("error", () => undefined);
  for (const t of [P, Q, R]) await runCityImport(pool, id(), t, { content: FIXTURE, fileName: "sp-ibge-2026-10-12.csv", sourceName: "IBGE", origin: "real", mapping: MAPPING });
});
afterAll(async () => { await pool.end(); });
const id = () => devIdentity([P, Q, R]);
const as = <T>(t: string, fn: (db: TenantDb) => Promise<T>) => withTenant(pool, id(), t, fn);
const count = (t: string, table: string) => as(t, async (db) => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM plataforma.${table}`)).rows[0]!.n));

describe("pesquisa de ponta a ponta com fontes reais (respostas capturadas)", () => {
  let first: Awaited<ReturnType<typeof runResearch>>;
  it("consulta as três fontes, grava evidência, oportunidades, scores e eventos, e fecha a execução", async () => {
    first = await runResearch(pool, id(), P, deps(), { entityLimit: 5 });
    expect(first.status).toBe("succeeded");
    expect(first.adapters.map((a) => [a.adapter, a.status])).toEqual([["bcb-sgs", "succeeded"], ["ibge-news", "succeeded"], ["rss-news", "succeeded"]]);
    expect(first.evidence.inserted).toBeGreaterThan(5);
    expect(first.opportunities.created).toBeGreaterThan(10);
    expect(first.scores.inserted).toBe(first.opportunities.created - first.opportunities.rejected);
    expect(await count(P, "evidence")).toBe(first.evidence.inserted);
    expect(await count(P, "growth_opportunity")).toBe(first.opportunities.created);
    const runs = await as(P, (db) => listResearchRuns(db));
    expect(runs[0]).toMatchObject({ id: first.runId, status: "succeeded" });
    expect(runs[0]!.finishedAt).not.toBeNull();
  });
  it("nenhuma oportunidade fica em 'discovered'; demanda é sempre desconhecida; nenhuma prioridade 'overall' sem demanda/SERP/concorrência", async () => {
    const l = await as(P, (db) => searchOpportunities(db, { limit: 100 }));
    expect(l.byStatus.discovered ?? 0).toBe(0);
    expect(l.rows.every((r) => r.hypothesis)).toBe(true);
    expect(l.rows.some((r) => r.priorityKind === "overall")).toBe(false);
    const d = (await as(P, (db) => getOpportunity(db, l.rows[0]!.id)))!;
    expect(d.demand).toMatchObject({ value: null, basis: "unknown" });
    expect(d.scores.length).toBe(1);
    // O histórico sai na ordem em que os fatos aconteceram (eventos da mesma transação têm o mesmo horário: a ordem vem da sequência).
    expect(d.events.slice(0, 4).map((e) => e.type)).toEqual(["discovered", "transition", "score", "transition"]);
    expect(d.events.slice(1, 2).concat(d.events.slice(3, 4)).map((e) => `${e.from}>${e.to}`)).toEqual(["discovered>validated", "validated>scored"]);
  });
  it("cada oportunidade explica de onde veio: entidade real do tenant, evidência com URL, fonte e data", async () => {
    const l = await as(P, (db) => searchOpportunities(db, { limit: 100 }));
    const withEvidence = (await Promise.all(l.rows.map((r) => as(P, (db) => getOpportunity(db, r.id))))).filter((d) => d!.evidence.length > 0);
    expect(withEvidence.length).toBeGreaterThan(0);
    const d = withEvidence[0]!;
    expect(d!.entity === null).toBe(d!.entityId === null); // hipóteses sem entidade (ex.: mercado geral) não inventam cidade
    expect(l.rows.some((r) => r.entityId !== null && r.location !== null)).toBe(true);
    for (const e of d!.evidence) {
      expect(e.evidence.url).toMatch(/^https:\/\//);
      expect(e.evidence.collectedAt).toBeInstanceOf(Date);
      expect(["observed", "provider_metric", "derived"]).toContain(e.evidence.basis);
      expect(e.reason.length).toBeGreaterThan(5);
    }
  });
  it("repetir a pesquisa com as mesmas respostas é idempotente: nada novo em evidência, oportunidades, scores nem vínculos", async () => {
    const before = { e: await count(P, "evidence"), o: await count(P, "growth_opportunity"), s: await count(P, "opportunity_score"), l: await count(P, "opportunity_evidence") };
    const again = await runResearch(pool, id(), P, deps(), { entityLimit: 5 });
    expect(again.status).toBe("succeeded");
    expect(again.evidence.inserted).toBe(0);
    expect(again.opportunities).toMatchObject({ created: 0, rejected: 0 });
    expect(again.scores.inserted).toBe(0);
    expect({ e: await count(P, "evidence"), o: await count(P, "growth_opportunity"), s: await count(P, "opportunity_score"), l: await count(P, "opportunity_evidence") }).toEqual(before);
  });
  it("outro tenant não vê nada e a mesma pesquisa nele gera o próprio conjunto, sem tocar o de P", async () => {
    expect(await count(Q, "growth_opportunity")).toBe(0);
    const pId = (await as(P, (db) => searchOpportunities(db, { limit: 1 }))).rows[0]!.id;
    expect(await as(Q, (db) => getOpportunity(db, pId))).toBeNull();
    const q = await runResearch(pool, id(), Q, deps(), { entityLimit: 5 });
    expect(q.status).toBe("succeeded");
    expect(await count(Q, "growth_opportunity")).toBe(first.opportunities.created);
    expect((await as(Q, (db) => searchEvidence(db))).every((e) => e.id !== undefined)).toBe(true);
    await expect(transitionOpportunity(pool, id(), Q, { opportunityId: pId, from: "eligible", to: "serp_analyzed", reason: "tentativa entre tenants" })).rejects.toThrow();
  });
});

describe("falhas e concorrência", () => {
  it("uma fonte fora do ar: a execução é 'partial', o que foi coletado é gravado e nada é inventado no lugar", async () => {
    const T = "fb222222-2222-4222-8222-222222222222";
    const routes = { ...OK, "https://api.bcb.gov.br/dados/serie/bcdata.sgs.189/": { status: 503 } };
    const r = await runResearch(pool, id(), T, deps(routes), { entityLimit: 3 });
    expect(r.status).toBe("partial");
    const bcb = r.adapters.find((a) => a.adapter === "bcb-sgs")!;
    expect(bcb.status).toBe("partial");
    expect(bcb.errors[0]).toMatchObject({ retryable: true });
    expect(bcb.kept).toBe(2); // só as duas séries que responderam; a terceira não vira registro
    expect(bcb.errors[0]!.target).toContain("189");
  });
  it("todas as fontes falham: a execução termina e as hipóteses continuam sem evidência (sem mocks)", async () => {
    const r = await runResearch(pool, id(), P, { ...deps({}), fetch: fakeFetch({ "https://": { throws: new Error("sem rede") } }) }, { entityLimit: 2 });
    expect(["partial", "failed"]).toContain(r.status);
    expect(r.adapters.every((a) => a.status === "failed")).toBe(true);
    expect(r.evidence.inserted).toBe(0);
  });
  it("já existe uma pesquisa em andamento: nova tentativa é recusada; abandonada há muito tempo é recuperada", async () => {
    const run = await as(P, async (db) => (await db.query<{ id: string }>(`INSERT INTO plataforma.research_run (tenant_id, vertical_id, params, created_by) VALUES (plataforma.current_tenant_id(), 'real-estate', '{}', 'teste') RETURNING id`)).rows[0]!.id);
    await expect(runResearch(pool, id(), P, deps())).rejects.toBeInstanceOf(ResearchBusyError);
    await as(P, (db) => db.query(`UPDATE plataforma.research_run SET started_at = now() - interval '2 hours' WHERE id = $1`, [run]));
    expect(await as(P, (db) => recoverStaleResearchRuns(db))).toEqual([run]);
    const ok = await runResearch(pool, id(), P, deps(), { entityLimit: 2 });
    expect(ok.status).toBe("succeeded");
  });
  it("entradas inválidas são recusadas antes de abrir execução", async () => {
    const n = await count(P, "research_run");
    await expect(runResearch(pool, id(), P, deps(), { adapterIds: ["inexistente"] })).rejects.toThrow(/desconhecido/);
    expect(await count(P, "research_run")).toBe(n);
  });
});

describe("ciclo de vida: o banco e o código usam a mesma tabela de transições", () => {
  it("opportunity_transition_ok coincide com TRANSITIONS em todos os 19x19 pares", async () => {
    const rows = await as(P, async (db) => (await db.query<{ a: string; b: string; ok: boolean }>(`SELECT a, b, plataforma.opportunity_transition_ok(a, b) AS ok FROM unnest($1::text[]) a CROSS JOIN unnest($1::text[]) b`, [STATES])).rows);
    expect(rows).toHaveLength(STATES.length ** 2);
    // Mesmo estado é permitido no banco por desenho (atualizar outras colunas sem mudar o status); no código, transição exige mudança.
    for (const r of rows) expect(r.ok, `${r.a} -> ${r.b}`).toBe(r.a === r.b || TRANSITIONS[r.a as keyof typeof TRANSITIONS].includes(r.b as never));
  });
  it("o gatilho recusa transição inválida mesmo por SQL direto, e a aplicação não apaga nem altera histórico", async () => {
    const o = (await as(P, (db) => searchOpportunities(db, { limit: 1 }))).rows[0]!;
    await expect(as(P, (db) => db.query(`UPDATE plataforma.growth_opportunity SET status = 'refreshed' WHERE id = $1`, [o.id]))).rejects.toThrow();
    await expect(as(P, (db) => db.query(`DELETE FROM plataforma.growth_opportunity WHERE id = $1`, [o.id]))).rejects.toThrow();
    await expect(as(P, (db) => db.query(`UPDATE plataforma.opportunity_score SET priority_value = 1 WHERE opportunity_id = $1`, [o.id]))).rejects.toThrow();
    await expect(as(P, (db) => db.query(`UPDATE plataforma.opportunity_event SET reason = 'x' WHERE opportunity_id = $1`, [o.id]))).rejects.toThrow();
    await expect(as(P, (db) => db.query(`UPDATE plataforma.evidence SET title = 'x'`))).rejects.toThrow();
  });
  it("transição válida grava o evento com autor e motivo; estado desatualizado, inválido e inexistente são recusados", async () => {
    const o = (await as(P, (db) => searchOpportunities(db, { status: "eligible", limit: 1 }))).rows[0] ?? (await as(P, (db) => searchOpportunities(db, { status: "scored", limit: 1 }))).rows[0]!;
    const to = o.status === "eligible" ? "serp_analyzed" : "retired";
    await transitionOpportunity(pool, id(), P, { opportunityId: o.id, from: o.status, to, reason: "decisão de teste" });
    const d = (await as(P, (db) => getOpportunity(db, o.id)))!;
    expect(d.status).toBe(to);
    expect(d.events.at(-1)).toMatchObject({ type: "transition", from: o.status, to, reason: "decisão de teste" });
    await expect(transitionOpportunity(pool, id(), P, { opportunityId: o.id, from: o.status, to, reason: "repetida" })).rejects.toBeInstanceOf(StaleStateError);
    await expect(transitionOpportunity(pool, id(), P, { opportunityId: o.id, from: to, to: "discovered", reason: "voltar" })).rejects.toBeInstanceOf(LifecycleError);
    await expect(transitionOpportunity(pool, id(), P, { opportunityId: "00000000-0000-4000-8000-000000000000", from: "eligible", to: "serp_analyzed", reason: "inexistente" })).rejects.toBeInstanceOf(OpportunityNotFoundError);
    await expect(transitionOpportunity(pool, id(), P, { opportunityId: "x", from: "eligible", to: "serp_analyzed", reason: "malformado" })).rejects.toBeInstanceOf(OpportunityNotFoundError);
    await expect(transitionOpportunity(pool, id(), P, { opportunityId: o.id, from: to, to: "refreshed", reason: "" })).rejects.toThrow();
  });
});

describe("score versionado e configurável", () => {
  it("a versão 1 nasce da configuração da vertical; salvar o mesmo conteúdo não duplica; uma mudança cria a versão 2", async () => {
    const v1 = await as(P, (db) => ensureActiveConfig(db, realEstateVertical, "teste"));
    expect(v1.version).toBe(1);
    const same = await saveScoreConfig(pool, id(), P, { verticalId: realEstateVertical.id, config: v1.config });
    expect(same).toMatchObject({ created: false, config: { version: 1 } });
    const changed = { ...v1.config, eligibility: { ...v1.config.eligibility, minExecutionFeasibility: Math.min(0.99, v1.config.eligibility.minExecutionFeasibility + 0.1) } };
    const v2 = await saveScoreConfig(pool, id(), P, { verticalId: realEstateVertical.id, config: changed, note: "mais rígido na viabilidade" });
    expect(v2).toMatchObject({ created: true, config: { version: 2 } });
    expect((await as(P, (db) => listScoreConfigs(db, realEstateVertical.id))).map((c) => c.version)).toEqual([2, 1]);
  });
  it("configuração inválida é recusada e nada é gravado", async () => {
    const v = await as(P, (db) => ensureActiveConfig(db, realEstateVertical, "teste"));
    const n = await count(P, "score_config");
    await expect(saveScoreConfig(pool, id(), P, { verticalId: realEstateVertical.id, config: { ...v.config, objectives: {} } as never })).rejects.toBeInstanceOf(ConfigError);
    expect(await count(P, "score_config")).toBe(n);
  });
  it("reavaliar com a versão 2 cria um novo score (o antigo permanece), compara as versões e é idempotente", async () => {
    const o = (await as(P, (db) => searchOpportunities(db, { limit: 1 }))).rows[0]!;
    const r = await rescoreOpportunity(pool, id(), P, { opportunityId: o.id, configVersion: 2 });
    expect(r).toMatchObject({ created: true, configVersion: 2 });
    expect(r.comparison).not.toBeNull();
    const d = (await as(P, (db) => getOpportunity(db, o.id)))!;
    expect(d.scores.map((s) => s.configVersion)).toEqual([2, 1]);
    const again = await rescoreOpportunity(pool, id(), P, { opportunityId: o.id, configVersion: 2 });
    expect(again).toMatchObject({ created: false, scoreId: r.scoreId });
    await expect(rescoreOpportunity(pool, id(), P, { opportunityId: o.id, configVersion: 99 })).rejects.toBeInstanceOf(ConfigError);
    await expect(rescoreOpportunity(pool, id(), Q, { opportunityId: o.id })).rejects.toBeInstanceOf(OpportunityNotFoundError);
  });
});

describe("leitura: filtros, ordenação e paginação", () => {
  it("busca sem acento, filtro por intenção e estado, ordenações estáveis e paginação sem repetir", async () => {
    const all = await as(P, (db) => searchOpportunities(db, { limit: 100 }));
    expect(all.total).toBeGreaterThan(10);
    const one = all.rows.find((r) => /[áàâãéêíóôõúç]/.test(r.primaryQuery));
    if (one) expect((await as(P, (db) => searchOpportunities(db, { q: one.primaryQuery.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase() }))).rows.map((r) => r.id)).toContain(one.id);
    const intent = all.rows[0]!.intent;
    const byIntent = await as(P, (db) => searchOpportunities(db, { intent, limit: 100 }));
    expect(byIntent.rows.every((r) => r.intent === intent)).toBe(true);
    for (const sort of ["priority", "commercial", "feasibility", "discovery", "recent", "query"] as const) {
      const seen = new Set<string>();
      for (let offset = 0; offset < all.total; offset += 7) for (const r of (await as(P, (db) => searchOpportunities(db, { sort, limit: 7, offset }))).rows) { expect(seen.has(r.id), `${sort} repetiu ${r.id}`).toBe(false); seen.add(r.id); }
      expect(seen.size, sort).toBe(all.total);
    }
    expect((await as(P, (db) => searchOpportunities(db, { q: "%", limit: 5 }))).total).toBe(0);
    expect((await as(P, (db) => searchOpportunities(db, { offset: 100000 }))).rows).toEqual([]);
    await expect(as(P, (db) => searchOpportunities(db, { status: "nao_existe" as never }))).rejects.toThrow();
  });
  it("identificador malformado ou inexistente: 'não existe' (nulo), nunca um erro do banco", async () => {
    for (const bad of ["x", "", "00000000-0000-0000-0000-00000000000g", "1; DROP TABLE plataforma.growth_opportunity", "00000000-0000-4000-8000-000000000000"]) expect(await as(P, (db) => getOpportunity(db, bad)), bad).toBeNull();
  });
});

// ---- Slice C/D: blueprint, gates de experiência e roadmap (ADR-024) -------------------------------------------------------------------------------------
// A pesquisa do tenant R usa a vertical imobiliária com DOIS ajustes de teste: o padrão "city-overview" é de valor alto e o mínimo de valor comercial é 30 (com o padrão da
// vertical, 37,9 não basta), para existir uma oportunidade ELEGÍVEL cuja experiência tem template REAL no registro (as demais experiências não têm: servem de caso de bloqueio).
const BP_VERTICAL = { ...realEstateVertical, scoring: { ...realEstateVertical.scoring, eligibility: { ...realEstateVertical.scoring.eligibility, minCommercialValue: 30 } }, patterns: realEstateVertical.patterns.map((p) => (p.key === "city-overview" ? { ...p, valueTier: "high" as const } : p)) };
const bpDeps = { vertical: BP_VERTICAL, templates: TEMPLATE_REGISTRY, now: () => NOW };

describe("blueprint, gates de experiência e roadmap", () => {
  let ready: { id: string; query: string };
  let blocked: { id: string; query: string };
  beforeAll(async () => {
    const r = await runResearch(pool, id(), R, { ...deps(), vertical: BP_VERTICAL }, { entityLimit: 5 });
    expect(r.status).toBe("succeeded");
    const el = await as(R, (db) => searchOpportunities(db, { status: "eligible", limit: 100 }));
    const pick = (exp: string) => el.rows.find((x) => x.experience === exp);
    ready = { id: pick("location_overview")!.id, query: pick("location_overview")!.primaryQuery };
    const other = el.rows.find((x) => x.experience !== "location_overview")!;
    blocked = { id: other.id, query: other.primaryQuery };
  });
  it("oportunidade elegível com template real e dados da cidade: blueprint PRONTO, seis gates, e a oportunidade NÃO avança sozinha (a SERP está pendente)", async () => {
    const r = await createBlueprint(pool, id(), R, bpDeps, { opportunityId: ready.id });
    expect(r.created).toBe(true);
    expect(r.record).toMatchObject({ version: 1, ready: true, templateKey: "city-overview" });
    expect(r.record.report.gates.map((g) => g.gate)).toEqual([...GATE_IDS]);
    expect(r.record.report.gates.some((g) => g.outcome === "fail")).toBe(false);
    expect(r.record.blueprint.path.proposed).toMatch(/^\/cidades\/sp\/[a-z0-9-]+$/);
    expect(r.record.blueprint.sections.every((s) => s.data === "available")).toBe(true);
    expect(r.record.blueprint.internalLinks.length).toBe(2);
    expect(r.transitioned).toBeNull();
    const d = (await as(R, (db) => getOpportunity(db, ready.id)))!;
    expect(d.status).toBe("eligible");
    expect(d.events.at(-1)).toMatchObject({ type: "blueprint" });
    const rm = await as(R, (db) => loadRoadmap(db, BP_VERTICAL, { perLane: 200 }));
    expect(rm.items.awaiting_blueprint.find((x) => x.id === ready.id)).toMatchObject({ blockers: ["serp_pending"] }); // pronto, mas a SERP pendente impede "pronta para construir"
    expect(rm.items.ready.some((x) => x.id === ready.id)).toBe(false);
  });
  it("exceção de SERP: exige motivo escrito e blueprint pronto; grava autor, horário, motivo e 'SERP não avaliada'; não autoriza publicação; é revisável", async () => {
    await expect(applySerpWaiver(pool, id(), R, { opportunityId: ready.id, reason: "curto" })).rejects.toBeInstanceOf(WaiverError);
    await expect(applySerpWaiver(pool, id(), R, { opportunityId: blocked.id, reason: "sem provedor de SERP contratado" })).rejects.toThrow(/blueprint/); // sem blueprint ainda
    await expect(applySerpWaiver(pool, id(), Q, { opportunityId: ready.id, reason: "sem provedor de SERP contratado" })).rejects.toBeInstanceOf(OpportunityNotFoundError);
    expect(await applySerpWaiver(pool, id(), R, { opportunityId: ready.id, reason: "sem provedor de SERP contratado; revisar ao integrar" })).toEqual({ blueprintVersion: 1 });
    const d = (await as(R, (db) => getOpportunity(db, ready.id)))!;
    expect(d.status).toBe("blueprinted");
    const last = d.events.at(-1)!;
    expect(last).toMatchObject({ type: "transition", from: "eligible", to: "blueprinted", actor: expect.stringMatching(/\S/) });
    expect(last.at).toBeInstanceOf(Date);
    expect(last.reason).toContain("EXCEÇÃO de SERP");
    expect(last.data).toMatchObject({ serpWaived: true, serp: "not_evaluated", reviewable: true, authorizesPublication: false, waiverReason: expect.stringContaining("revisar ao integrar") });
    expect(findSerpWaiver(d.events)).toMatchObject({ reviewed: false, blueprintVersion: 1, reason: expect.stringContaining("sem provedor") });
    await expect(applySerpWaiver(pool, id(), R, { opportunityId: ready.id, reason: "sem provedor de SERP contratado de novo" })).rejects.toBeInstanceOf(BlueprintStateError);
    const rm = await as(R, (db) => loadRoadmap(db, BP_VERTICAL, { perLane: 200 }));
    expect(rm.items.ready.find((x) => x.id === ready.id)).toMatchObject({ blockers: ["serp_waiver"] }); // pronta, com a pendência de SERP visível
  });
  it("repetir é idempotente: mesma versão, nenhum evento nem transição nova", async () => {
    const before = await count(R, "opportunity_event");
    const again = await createBlueprint(pool, id(), R, bpDeps, { opportunityId: ready.id });
    expect(again).toMatchObject({ created: false, transitioned: null, record: { version: 1 } });
    expect(await count(R, "opportunity_event")).toBe(before);
    expect(await count(R, "page_blueprint")).toBe(1);
  });
  it("experiência sem template: blueprint NÃO pronto, com o bloqueio exato; a oportunidade NÃO avança; repetir não duplica", async () => {
    const r = await createBlueprint(pool, id(), R, bpDeps, { opportunityId: blocked.id });
    expect(r.record.ready).toBe(false);
    expect(r.record.templateKey).toBeNull();
    expect(r.transitioned).toBeNull();
    expect(r.record.report.blockers.map((b) => b.key)).toEqual(expect.arrayContaining([expect.stringMatching(/^(template|experience|evidence):/)]));
    await expect(applySerpWaiver(pool, id(), R, { opportunityId: blocked.id, reason: "tentando dispensar a SERP de um blueprint bloqueado" })).rejects.toThrow(/gates reprovados/);
    expect((await as(R, (db) => getOpportunity(db, blocked.id)))!.status).toBe("eligible");
    expect((await createBlueprint(pool, id(), R, bpDeps, { opportunityId: blocked.id })).created).toBe(false);
    expect((await as(R, (db) => listBlueprints(db, blocked.id))).length).toBe(1);
  });
  it("estado inadequado, malformado, inexistente e de outro tenant são recusados sem efeito", async () => {
    const scored = (await as(R, (db) => searchOpportunities(db, { status: "scored", limit: 1 }))).rows[0]!;
    const n = await count(R, "page_blueprint");
    await expect(createBlueprint(pool, id(), R, bpDeps, { opportunityId: scored.id })).rejects.toBeInstanceOf(BlueprintStateError);
    await expect(createBlueprint(pool, id(), R, bpDeps, { opportunityId: "x" })).rejects.toBeInstanceOf(OpportunityNotFoundError);
    await expect(createBlueprint(pool, id(), R, bpDeps, { opportunityId: "00000000-0000-4000-8000-000000000000" })).rejects.toBeInstanceOf(OpportunityNotFoundError);
    await expect(createBlueprint(pool, id(), Q, bpDeps, { opportunityId: ready.id })).rejects.toBeInstanceOf(OpportunityNotFoundError);
    expect(await count(R, "page_blueprint")).toBe(n);
    expect(await count(Q, "page_blueprint")).toBe(0);
    expect(await as(Q, (db) => listBlueprints(db, ready.id))).toEqual([]);
  });
  it("o histórico é imutável e o banco recusa pronto sem template", async () => {
    await expect(as(R, (db) => db.query(`UPDATE plataforma.page_blueprint SET ready = false`))).rejects.toThrow();
    await expect(as(R, (db) => db.query(`DELETE FROM plataforma.page_blueprint`))).rejects.toThrow();
    await expect(as(R, (db) => db.query(`INSERT INTO plataforma.page_blueprint (tenant_id, opportunity_id, version, content, content_hash, ready, gates, created_by) VALUES (plataforma.current_tenant_id(), $1, 99, '{}', repeat('a', 64), true, '[1,2,3,4,5,6]', 'teste')`, [blocked.id]))).rejects.toThrow(/check/i);
  });
  it("o roadmap soma os bloqueios, separa por prontidão e cobre TODAS as oportunidades em andamento", async () => {
    const rm = await as(R, (db) => loadRoadmap(db, BP_VERTICAL));
    expect(rm.counts.ready).toBe(1);
    expect(rm.counts.blocked).toBe(1);
    expect(rm.byStatus.blueprinted).toBe(1);
    expect(rm.items.ready[0]).toMatchObject({ id: ready.id, blueprintVersion: 1, blockers: ["serp_waiver"] });
    expect(rm.items.blocked[0]!.blockers.length).toBeGreaterThan(0);
    const active = (await as(R, (db) => searchOpportunities(db, { limit: 100 }))).rows.filter((x) => !["discovered", "validated", "rejected", "retired"].includes(x.status)).length;
    expect(rm.total).toBe(active);
    expect(Object.values(rm.counts).reduce((a, b) => a + b, 0)).toBe(rm.total);
    // o bloqueio mais comum das não elegíveis é a falta de demanda/justificativa: aparece somado, com rótulo legível
    const top = rm.blockers.find((b) => b.key === "eligibility:demand_or_strategic");
    expect(top).toMatchObject({ lane: "needs_work", label: expect.stringContaining("demanda") });
    expect(top!.count).toBeGreaterThan(10);
    expect(rm.blockers.every((b, i, a) => i === 0 || a[i - 1]!.count >= b.count)).toBe(true);
    expect((await as(Q, (db) => loadRoadmap(db, BP_VERTICAL))).total).toBeGreaterThan(0); // Q tem as próprias oportunidades...
    expect((await as(Q, (db) => loadRoadmap(db, BP_VERTICAL))).counts.ready).toBe(0); // ...mas nenhum blueprint de R
  });
  it("oportunidades encerradas (aposentadas) saem do roadmap", async () => {
    const before = await as(R, (db) => loadRoadmap(db, BP_VERTICAL, { perLane: 200 }));
    const victim = before.items.needs_work[0]!;
    await transitionOpportunity(pool, id(), R, { opportunityId: victim.id, from: victim.status, to: "retired", reason: "fora do foco" });
    const after = await as(R, (db) => loadRoadmap(db, BP_VERTICAL, { perLane: 200 }));
    expect(after.total).toBe(before.total - 1);
    expect(after.counts.needs_work).toBe(before.counts.needs_work - 1);
    expect(after.items.needs_work.some((x) => x.id === victim.id)).toBe(false);
  });
  it("o roadmap usa sempre a ÚLTIMA versão do blueprint (uma versão mais nova pronta tira a oportunidade de 'bloqueada' e a deixa à espera da SERP)", async () => {
    await as(R, (db) => db.query(`INSERT INTO plataforma.page_blueprint (tenant_id, opportunity_id, version, content, content_hash, template_key, template_version, ready, gates, blockers, created_by) VALUES (plataforma.current_tenant_id(), $1, 2, '{"teste": true}', repeat('b', 64), 'city-overview', 1, true, '[1,2,3,4,5,6]', '[]', 'teste')`, [blocked.id]));
    const rm = await as(R, (db) => loadRoadmap(db, BP_VERTICAL));
    expect(rm.counts).toMatchObject({ ready: 1, blocked: 0 });
    // a versão 2 está pronta, mas a oportunidade segue "elegível": falta a etapa de SERP, então não é "pronta para construir"
    expect(rm.items.awaiting_blueprint.find((x) => x.id === blocked.id)).toMatchObject({ blueprintVersion: 2, blockers: ["serp_pending"] });
    expect((await as(R, (db) => listBlueprints(db, blocked.id))).map((b) => b.version)).toEqual([2, 1]);
  });
});

