import { createHash } from "node:crypto";
import { DIMENSIONS, GATES, validatePolicy, type Decision, type DimensionId, type DimensionScore, type EligibilityDecision, type EligibilityPolicy, type EligibilitySnapshot, type GateId, type GateResult } from "./types";

// evaluate(): gates G1–G9 (não compensatórios) → pisos → score ponderado → decisão. PURA: só lê o snapshot e a política. Nenhuma data de relógio, nenhum LLM.
const r2 = (n: number) => Number(n.toFixed(3));
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const DAY = 86_400_000;

export function evaluateGates(s: EligibilitySnapshot, p: EligibilityPolicy): Record<GateId, GateResult> {
  const t = s.topic; const fam = p.families[t.family];
  const pass = (detail: string, extra: Partial<GateResult> = {}): GateResult => ({ result: "PASS", kind: null, detail, missing: [], ...extra });
  const fail = (kind: "data" | "blocking", detail: string, missing: readonly string[] = []): GateResult => ({ result: "FAIL", kind, detail, missing });
  const attrs = new Map(s.attributes.map((a) => [a.attributeId, a]));
  const factsBy = new Map<string, typeof s.facts[number][]>();
  for (const f of s.facts) factsBy.set(f.attributeId, [...(factsBy.get(f.attributeId) ?? []), f]);
  const ref = new Date(s.referenceTime).getTime();

  const G1 = s.entity === null ? fail("blocking", "a entidade primária não existe") : s.entity.status !== "ACTIVE" ? fail("blocking", `a entidade primária está ${s.entity.status}`) : s.entity.resolutionConfidence < p.minResolutionConfidence ? fail("blocking", `confiança de resolução ${s.entity.resolutionConfidence} abaixo de ${p.minResolutionConfidence}`) : pass(`entidade ACTIVE, resolução ${s.entity.resolutionConfidence}`);

  const hasIntent = t.queryHypothesis.trim() !== "" && !!t.intentType;
  const demandObserved = t.demand.value !== null;
  const G2 = !hasIntent ? fail("data", "a intenção não foi identificada nem há hipótese documentada", ["intenção"]) : demandObserved ? pass(`intenção ${t.intentType} com sinal de demanda (${t.demand.source ?? "fonte não informada"})`) : pass(`intenção ${t.intentType} como HIPÓTESE documentada: sem sinal de demanda (decisão máxima: RESEARCH_REQUIRED)`, { hypothesis: true });

  const missingBlocks = [...t.dataMissing];
  const G3 = !fam ? fail("data", `a política não define a família ${t.family}`, [`política da família ${t.family}`]) : missingBlocks.length > 0 ? fail("data", `faltam ${missingBlocks.length} bloco(s) obrigatório(s): ${missingBlocks.join(", ")}`, missingBlocks) : t.dataAvailable.length < fam.minBlocks ? fail("data", `${t.dataAvailable.length} bloco(s) de dados abaixo do mínimo de ${fam.minBlocks} da família`, [`mais ${fam.minBlocks - t.dataAvailable.length} bloco(s) de dados`]) : pass(`${t.dataAvailable.length} bloco(s) disponíveis (mínimo ${fam.minBlocks})`);

  const mandatory = t.attributesUsed.filter((a) => t.dataAvailable.includes(a) || t.dataMissing.includes(a));
  const noSource = mandatory.filter((a) => t.dataAvailable.includes(a) && !(factsBy.get(a) ?? []).every((f) => f.sourceName.trim() !== ""));
  const usedFacts = s.facts.filter((f) => t.dataAvailable.includes(f.attributeId));
  const meanConf = usedFacts.length === 0 ? null : usedFacts.reduce((x, f) => x + f.confidence, 0) / usedFacts.length;
  const inferred = t.dataAvailable.filter((a) => attrs.get(a)?.usableAsFact === false);
  const G4 = t.dataMissing.length > 0 ? fail("data", `blocos obrigatórios sem fato com fonte: ${t.dataMissing.join(", ")}`, [...t.dataMissing]) : noSource.length > 0 ? fail("data", `fatos sem fonte: ${noSource.join(", ")}`, noSource) : inferred.length > 0 ? fail("blocking", `atributo(s) INFERRED usados como fato: ${inferred.join(", ")}`) : meanConf === null ? fail("data", "nenhum fato com fonte para avaliar a confiança", ["fatos com fonte"]) : meanConf < p.minEvidenceConfidence ? fail("data", `confiança média ${r2(meanConf)} abaixo de ${p.minEvidenceConfidence}`, ["evidência de maior confiança"]) : pass(`100% dos blocos com fonte; confiança média ${r2(meanConf)}`);

  const G5 = s.varyingBlocks >= p.minUniqueBlocks ? pass(`${s.varyingBlocks} bloco(s) variam entre as instâncias da família (mínimo ${p.minUniqueBlocks})`) : fail("data", `apenas ${s.varyingBlocks} bloco(s) de dados variam entre as instâncias da família (mínimo ${p.minUniqueBlocks}): a página seria quase idêntica à das irmãs`, [`mais ${p.minUniqueBlocks - s.varyingBlocks} bloco(s) que variem por instância`]);

  const G6 = s.coherenceConflicts.length > 0 ? fail("blocking", `conflito geográfico/semântico: ${s.coherenceConflicts.join("; ")}`) : pass("sem conflito geográfico ou semântico");

  const stale: string[] = [];
  for (const f of usedFacts) if (f.maxAgeDays !== null && (ref - new Date(f.observedAt).getTime()) / DAY > f.maxAgeDays) stale.push(`${f.attributeId} (${Math.floor((ref - new Date(f.observedAt).getTime()) / DAY)} dias > ${f.maxAgeDays})`);
  const G7 = stale.length > 0 ? fail("data", `dados acima da validade: ${stale.join(", ")}`, stale.map((x) => `atualizar ${x.split(" ")[0]}`)) : pass("todos os fatos dentro da validade");

  const viol: string[] = [];
  for (const a of t.attributesUsed) { const at = attrs.get(a); if (!at) continue;
    if (p.forbiddenCategories.includes(at.semanticCategory)) viol.push(`R5: ${a} é da categoria proibida “${at.semanticCategory}”`);
    if (at.derivationMethod === "routing_travel_time" && !(factsBy.get(a) ?? []).length) viol.push(`R3: ${a} (tempo de deslocamento) sem fato com fonte de roteamento`); }
  const G8 = viol.length > 0 ? fail("blocking", viol.join("; ")) : pass("compatível com as regras R3, R5 e R10");

  const open = s.conflicts.filter((c) => !c.resolved && c.similarity >= p.similarityThreshold);
  const G9 = open.length > 0 ? fail("blocking", `canibalização não resolvida com ${open.length} tópico(s): ${open.map((c) => `${c.topicId.slice(0, 8)} (${r2(c.similarity)})`).join(", ")}`) : pass("nenhum conflito impeditivo de canibalização");
  return { G1_entity: G1, G2_intent: G2, G3_data_sufficiency: G3, G4_evidence: G4, G5_uniqueness: G5, G6_geo_semantic: G6, G7_freshness: G7, G8_policy: G8, G9_cannibalization: G9 };
}

export function scoreDimensions(s: EligibilitySnapshot, p: EligibilityPolicy): Record<DimensionId, DimensionScore> {
  const t = s.topic; const fam = p.families[t.family];
  const used = s.facts.filter((f) => t.dataAvailable.includes(f.attributeId));
  const ref = new Date(s.referenceTime).getTime();
  const mk = (id: DimensionId, score: number | null, inputs: Record<string, unknown>, justification: string, uncertainty: string): DimensionScore => ({ score: score === null ? null : r2(clamp(score)), weight: p.weights[id], floor: p.floors[id] ?? null, inputs, justification, uncertainty });
  const demand = t.demand.value === null ? null : (100 * Math.log10(1 + t.demand.value)) / Math.log10(1 + p.demandSaturation);
  const meanConf = used.length === 0 ? null : used.reduce((x, f) => x + f.confidence, 0) / used.length;
  const fresh = used.length === 0 ? null : used.reduce((x, f) => x + (f.maxAgeDays === null ? 1 : Math.max(0, 1 - ((ref - new Date(f.observedAt).getTime()) / DAY) / f.maxAgeDays)), 0) / used.length;
  const c = p.connectivity;
  const conn = c.parent * (t.parentTopicId ? 1 : 0) + c.siblings * Math.min(s.graph.siblings, c.siblingCap) / c.siblingCap + c.children * Math.min(s.graph.children, c.childCap) / c.childCap;
  return {
    search_demand: mk("search_demand", demand, { value: t.demand.value, saturation: p.demandSaturation }, demand === null ? "sem sinal de demanda: dimensão desconhecida (não é zero)" : `escala logarítmica do volume estimado (${t.demand.value}) saturando em ${p.demandSaturation}`, "volume de busca é estimativa (R11)"),
    user_utility: mk("user_utility", fam ? (100 * t.dataAvailable.length) / fam.idealBlocks : null, { blocks: t.dataAvailable.length, ideal: fam?.idealBlocks ?? null }, `${t.dataAvailable.length} de ${fam?.idealBlocks ?? "?"} blocos ideais da família`, "proxy da utilidade: quantidade de blocos de dados úteis"),
    data_availability: mk("data_availability", t.attributesUsed.length === 0 ? null : (100 * t.dataAvailable.length) / t.attributesUsed.length, { available: t.dataAvailable.length, used: t.attributesUsed.length }, `${t.dataAvailable.length} de ${t.attributesUsed.length} atributos usados têm fato`, "nenhuma"),
    evidence_quality: mk("evidence_quality", meanConf === null ? null : 100 * meanConf, { meanConfidence: meanConf, facts: used.length }, meanConf === null ? "sem fatos" : `confiança média ${r2(meanConf)} dos ${used.length} fatos com fonte`, "a confiança vem da qualidade da fonte declarada pelo pack"),
    uniqueness: mk("uniqueness", (100 * s.varyingBlocks) / p.uniquenessTarget, { varyingBlocks: s.varyingBlocks, target: p.uniquenessTarget }, `${s.varyingBlocks} bloco(s) variam entre as instâncias (alvo ${p.uniquenessTarget})`, "depende das instâncias existentes da família"),
    business_relevance: mk("business_relevance", p.businessRelevance[t.commercialPotential as keyof typeof p.businessRelevance] ?? null, { potential: t.commercialPotential }, `potencial comercial “${t.commercialPotential}” declarado pelo pack`, "julgamento do pack, não medido"),
    conversion_potential: mk("conversion_potential", p.conversion[t.intentType] ?? null, { intent: t.intentType }, `proximidade de conversão da intenção ${t.intentType} (tabela da política)`, "julgamento da política, não medido"),
    serp_opportunity: mk("serp_opportunity", s.serp.opportunity, { serp: s.serp.opportunity }, s.serp.opportunity === null ? "SERP não analisada: dimensão desconhecida (não é zero)" : "oportunidade de SERP medida", s.serp.opportunity === null ? "sem provedor de SERP" : "snapshot de SERP"),
    graph_connectivity: mk("graph_connectivity", conn, { parent: !!t.parentTopicId, siblings: s.graph.siblings, children: s.graph.children }, `pai ${t.parentTopicId ? "sim" : "não"}, ${s.graph.siblings} irmão(s), ${s.graph.children} filho(s) (pesos da política)`, "estrutura atual do grafo de tópicos"),
    production_cost: mk("production_cost", fam ? 100 - fam.maintenanceCost : null, { maintenanceCost: fam?.maintenanceCost ?? null }, fam ? `custo de produção/manutenção ${fam.maintenanceCost}/100 (invertido)` : "família sem custo na política", "estimativa da política"),
    freshness: mk("freshness", fresh === null ? null : 100 * fresh, { facts: used.length }, fresh === null ? "sem fatos" : "fração média da validade ainda disponível", "depende do instante de referência"),
    geo_ai_discoverability: mk("geo_ai_discoverability", fam?.geoScore ?? null, { geoScore: fam?.geoScore ?? null }, fam?.geoScore == null ? "sem medida de descoberta por IA para a família: desconhecida" : "preparo declarado da família", "não medido por monitoramento de citações"),
  };
}

export function evaluate(s: EligibilitySnapshot, p: EligibilityPolicy, policyVersion: number): EligibilityDecision {
  const gates = evaluateGates(s, p);
  const gateResults = Object.fromEntries(GATES.map((g) => [g, gates[g].result])) as Record<GateId, "PASS" | "FAIL">;
  const failed = GATES.filter((g) => gates[g].result === "FAIL");
  const blocking = failed.filter((g) => gates[g].kind === "blocking").map((g) => `${g}: ${gates[g].detail}`);
  const missing = failed.filter((g) => gates[g].kind === "data").flatMap((g) => gates[g].missing.map((m) => `${g}: ${m}`));
  const refs = [...new Set(s.facts.map((f) => f.factId))].sort();
  const base = { topicId: s.topic.topicId, gateResults, gateDetails: gates, evidenceRefs: refs, policyVersion, evaluatedAt: s.referenceTime };
  const done = (decision: Decision, o: { scores: EligibilityDecision["scores"]; total: number | null; cov: number | null; floors?: string[]; action: string }): EligibilityDecision =>
    ({ ...base, decision, eligible: decision === "READY_FOR_BLUEPRINT", blockingReasons: blocking, missingRequirements: missing, scores: o.scores, totalScore: o.total, weightCoverage: o.cov, floorFailures: o.floors ?? [], recommendedAction: o.action });

  // gates FAIL: nenhuma nota supera isso. Impedimento → REJECTED; só falta de dado → DATA_REQUIRED.
  if (blocking.length > 0) return done("REJECTED", { scores: null, total: null, cov: null, action: `Resolver o impedimento: ${blocking[0]}` });
  if (missing.length > 0) return done("DATA_REQUIRED", { scores: null, total: null, cov: null, action: `Obter o que falta: ${missing.slice(0, 3).join("; ")}` });

  const scores = scoreDimensions(s, p);
  const known = DIMENSIONS.filter((d) => scores[d].score !== null);
  const wKnown = known.reduce((x, d) => x + p.weights[d], 0);
  const coverage = r2(wKnown / 100);
  const total = wKnown === 0 ? null : r2(known.reduce((x, d) => x + p.weights[d] * scores[d].score!, 0) / wKnown);
  const floorFailures = DIMENSIONS.filter((d) => p.floors[d] !== undefined && scores[d].score !== null && scores[d].score! < p.floors[d]!).map((d) => `${d} ${scores[d].score} < piso ${p.floors[d]}`);

  // sem demanda observada: a hipótese só pode seguir como pesquisa (R11/R12), qualquer que seja a nota
  if (scores.search_demand.score === null) return done("RESEARCH_REQUIRED", { scores, total, cov: coverage, floors: floorFailures, action: "Obter um sinal de demanda (Search Console, Trends, SERP ou keywords) com fonte, período e incerteza" });
  if (floorFailures.length > 0) return done("DATA_REQUIRED", { scores, total, cov: coverage, floors: floorFailures, action: `Elevar as dimensões abaixo do piso: ${floorFailures.join("; ")}` });
  if (coverage < p.minWeightCoverage || total === null) return done("DATA_REQUIRED", { scores, total, cov: coverage, action: `Cobertura das dimensões ${coverage} abaixo de ${p.minWeightCoverage}: obter as dimensões desconhecidas` });
  if (total >= p.readyMin) return done("READY_FOR_BLUEPRINT", { scores, total, cov: coverage, action: "Gerar o blueprint" });
  if (total >= p.dataRequiredMin) return done("DATA_REQUIRED", { scores, total, cov: coverage, action: `Total ${total} abaixo de ${p.readyMin}: elevar as dimensões de menor nota` });
  return done("REJECTED", { scores, total, cov: coverage, action: `Total ${total} abaixo de ${p.dataRequiredMin}: não vale produzir a página` });
}

const canon = (v: unknown): string => (v === null || typeof v !== "object" ? JSON.stringify(v) ?? "null" : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`);
/** Hash do snapshot (ordem das listas normalizada): a idempotência e o teste de regressão dependem dele. */
export function snapshotHash(s: EligibilitySnapshot): string {
  const sorted = { ...s, attributes: [...s.attributes].sort((a, b) => (a.attributeId < b.attributeId ? -1 : 1)), facts: [...s.facts].sort((a, b) => (a.factId < b.factId ? -1 : 1)), conflicts: [...s.conflicts].sort((a, b) => (a.topicId < b.topicId ? -1 : 1)), coherenceConflicts: [...s.coherenceConflicts].sort() };
  return createHash("sha256").update(canon(sorted)).digest("hex");
}
export { validatePolicy };
