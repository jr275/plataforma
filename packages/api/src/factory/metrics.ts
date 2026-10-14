import type { TenantDb } from "../tenant-context";

// Camada de métricas da fábrica: cada métrica declara fonte, escopo e definição operacional, e SEMPRE diz qual é o seu tipo (estado atual, acumulado, eventos no período, páginas únicas, versões,
// tentativas, deployments). Nada soma eventos históricos como páginas únicas. Sem instrumentação (ex.: indexação) o valor é "não instrumentado", nunca zero.
export type MetricKind = "current_state" | "accumulated" | "period_events" | "unique_pages" | "versions" | "attempts" | "deployments";
export interface MetricDef { readonly id: string; readonly label: string; readonly kind: MetricKind; readonly meaning: string; readonly source: string; readonly scope: string; /** Lista que explica o número (filtros já aplicados). */ readonly href: string | null }
export type MetricValue = { readonly state: "available"; readonly value: number; /** Só para eventos no período: valor do período anterior de mesma duração. */ readonly previous: number | null } | { readonly state: "not_instrumented"; readonly reason: string };

export const METRICS: readonly MetricDef[] = [
  { id: "entities_available", label: "Entidades no grafo", kind: "current_state", meaning: "Entidades ativas (cidades, bairros…) com identidade resolvida.", source: "entity", scope: "tenant, status ACTIVE", href: null },
  { id: "attributes_discovered", label: "Atributos descobertos", kind: "current_state", meaning: "Atributos do catálogo mais recente (um por tipo de entidade e atributo), com cobertura medida.", source: "attribute_catalog (última catalog_run)", scope: "tenant, última execução", href: null },
  { id: "topics_discovered", label: "Temas identificados", kind: "unique_pages", meaning: "Tópicos únicos (identidade determinística) gerados pelo motor, em qualquer estado.", source: "growth_opportunity (topic_id)", scope: "tenant", href: "/engine/topics" },
  { id: "combinations_evaluated", label: "Combinações analisadas", kind: "accumulated", meaning: "Registros do Combination Engine (mantidas, podadas, duplicadas, cortadas). Eventos acumulados: não são páginas.", source: "combination_log", scope: "tenant, acumulado", href: "/engine/topics" },
  { id: "opportunities_eligible", label: "Aprovadas para blueprint", kind: "current_state", meaning: "Tópicos cuja decisão VIGENTE de elegibilidade é READY_FOR_BLUEPRINT.", source: "eligibility_decision (última por tópico)", scope: "tenant, estado atual", href: "/engine/eligibility?decision=READY_FOR_BLUEPRINT" },
  { id: "blueprints_created", label: "Blueprints criados", kind: "unique_pages", meaning: "Oportunidades com ao menos um blueprint da especificação (versões não são somadas).", source: "spec_blueprint", scope: "tenant, oportunidades únicas", href: "/engine/pages?stage=blueprint" },
  { id: "blueprint_versions", label: "Versões de blueprint", kind: "versions", meaning: "Total de versões gravadas de blueprint.", source: "spec_blueprint", scope: "tenant, acumulado", href: null },
  { id: "pages_generating", label: "Páginas em geração", kind: "current_state", meaning: "Execuções do pipeline de página em andamento agora.", source: "pipeline_run (RUNNING)", scope: "tenant, estado atual", href: "/engine/pipelines" },
  { id: "pages_generated", label: "Páginas geradas", kind: "unique_pages", meaning: "Oportunidades com recipe compilado (candidatas a QA); não significa aprovada nem publicada.", source: "page_recipe", scope: "tenant, páginas únicas", href: "/engine/pages?stage=generated" },
  { id: "recipe_versions", label: "Versões de recipe", kind: "versions", meaning: "Total de versões de recipe gravadas (uma página pode ter várias).", source: "page_recipe", scope: "tenant, acumulado", href: null },
  { id: "pages_awaiting_qa", label: "Aguardando QA", kind: "current_state", meaning: "Páginas em data_assembled, evidence_validated ou experience_built: ainda sem relatório de QA concluído.", source: "growth_opportunity.status", scope: "tenant, estado atual", href: "/engine/pages?stage=awaiting_qa" },
  { id: "pages_qa_passed", label: "QA aprovado", kind: "current_state", meaning: "Páginas cujo relatório de QA mais recente é QA_PASSED.", source: "qa_report (último por oportunidade)", scope: "tenant, estado atual", href: "/engine/pages?qa=QA_PASSED" },
  { id: "pages_awaiting_approval", label: "Aguardando aprovação", kind: "current_state", meaning: "QA aprovado e sem decisão humana sobre a versão mais recente do recipe.", source: "qa_report + page_approval", scope: "tenant, estado atual", href: "/engine/pages?stage=awaiting_approval" },
  { id: "pages_approved", label: "Aprovadas para revisão", kind: "current_state", meaning: "A versão mais recente do recipe tem aprovação humana vigente. Aprovar não publica.", source: "page_approval (última por recipe)", scope: "tenant, estado atual", href: "/engine/pages?stage=approved" },
  { id: "pages_deployed_preview", label: "Em preview (deployment pronto)", kind: "unique_pages", meaning: "Páginas únicas presentes em deployment de PREVIEW com estado READY, VERIFICATION_PENDING ou VERIFIED.", source: "deployment_page + deployment", scope: "tenant, páginas únicas", href: "/engine/deployments" },
  { id: "pages_published", label: "Publicadas", kind: "unique_pages", meaning: "Páginas únicas em deployment de PRODUÇÃO pronto (READY ou além). Publicada não significa indexada.", source: "deployment_page + deployment (production)", scope: "tenant, páginas únicas", href: "/engine/deployments" },
  { id: "pages_gate_approval", label: "Gate: aprovação liberada", kind: "current_state", meaning: "Páginas cujo Quality Gate de arquitetura mais recente libera a APROVAÇÃO (contrato, intenção, template, canonical, schema e QA).", source: "quality_gate_result (último por oportunidade)", scope: "tenant, estado atual", href: "/engine/pages?eligibility=approval" },
  { id: "pages_gate_indexing", label: "Gate: indexação liberada", kind: "current_state", meaning: "Páginas cujo gate libera a INDEXAÇÃO (densidade, proveniência, inlinks contextuais, schema, canonical e política). É elegibilidade, não indexação observada.", source: "quality_gate_result (último por oportunidade)", scope: "tenant, estado atual", href: "/engine/pages?eligibility=indexing" },
  { id: "pages_insufficient_inlinks", label: "Inlinks insuficientes", kind: "current_state", meaning: "Páginas retidas por INSUFFICIENT_CONTEXTUAL_INLINKS (menos inlinks contextuais válidos que o mínimo da política).", source: "quality_gate_result", scope: "tenant, estado atual", href: "/engine/pages?linkFailure=1" },
  { id: "intent_conflicts", label: "Páginas com conflito de intenção", kind: "current_state", meaning: "Páginas em conflito determinístico de intenção/URL/canonical (sinais de sobreposição não contam).", source: "quality_gate_result", scope: "tenant, estado atual", href: "/engine/pages?conflict=1" },
  { id: "pages_indexed", label: "Indexadas (observado)", kind: "unique_pages", meaning: "Páginas cuja observação MAIS RECENTE de indexação é INDEXED. Só medição real (Search Console ou inspeção manual) afirma isso; elegibilidade não conta.", source: "indexation_observation", scope: "tenant, última observação por página", href: null },
  { id: "deployments_total", label: "Deployments", kind: "deployments", meaning: "Deployments registrados (qualquer estado).", source: "deployment", scope: "tenant, acumulado", href: "/engine/deployments" },
  { id: "deployments_verified", label: "Deployments verificados", kind: "deployments", meaning: "Deployments cujas URLs foram verificadas depois do build (VERIFIED).", source: "deployment", scope: "tenant, estado atual", href: "/engine/deployments?status=VERIFIED" },
  { id: "pages_blocked", label: "Páginas bloqueadas", kind: "current_state", meaning: "Oportunidades cuja execução MAIS RECENTE do pipeline terminou BLOCKED.", source: "pipeline_run (última por oportunidade)", scope: "tenant, estado atual", href: "/engine/pipelines" },
  { id: "generation_failures", label: "Falhas de processamento", kind: "period_events", meaning: "Execuções de pipeline FAILED e execuções de agente com falha (failed, invalid_output, timed_out) no período. Eventos, não páginas.", source: "pipeline_run + agent_run", scope: "período", href: "/engine/executions?status=failed" },
  { id: "pipeline_runs", label: "Execuções de pipeline", kind: "attempts", meaning: "Tentativas de pipeline iniciadas no período (uma página pode ter várias).", source: "pipeline_run", scope: "período", href: "/engine/pipelines" },
];
const NOT_INSTRUMENTED_REASON = "Nenhuma observação de indexação registrada (sem Search Console ou inspeção): a indexação não é medida, então zero seria uma afirmação falsa.";

export interface FactoryMetrics { readonly asOf: Date; readonly periodDays: number; readonly values: Readonly<Record<string, MetricValue>> }
export async function factoryMetrics(db: TenantDb, o: { periodDays?: number } = {}): Promise<FactoryMetrics> {
  const days = Math.min(Math.max(Math.trunc(o.periodDays ?? 7), 1), 365);
  const r = (await db.query<Record<string, string>>(`
    WITH latest_dec AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, decision FROM plataforma.eligibility_decision ORDER BY opportunity_id, seq DESC),
         latest_qa AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, outcome, recipe_id FROM plataforma.qa_report ORDER BY opportunity_id, seq DESC),
         latest_recipe AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, id AS recipe_id FROM plataforma.page_recipe ORDER BY opportunity_id, version DESC),
         latest_appr AS (SELECT DISTINCT ON (recipe_id) recipe_id, decision FROM plataforma.page_approval ORDER BY recipe_id, seq DESC),
         latest_gate AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, eligible_approval, eligible_indexing, failed_rules, result FROM plataforma.quality_gate_result ORDER BY opportunity_id, seq DESC),
         latest_obs AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, state FROM plataforma.indexation_observation ORDER BY opportunity_id, observed_at DESC, seq DESC),
         latest_run AS (SELECT DISTINCT ON (opportunity_id) opportunity_id, status, final_outcome FROM plataforma.pipeline_run WHERE pipeline = 'page' AND opportunity_id IS NOT NULL ORDER BY opportunity_id, seq DESC),
         dep_pages AS (SELECT dp.opportunity_id, d.target FROM plataforma.deployment_page dp JOIN plataforma.deployment d ON d.id = dp.deployment_id AND d.tenant_id = dp.tenant_id WHERE d.status IN ('READY', 'VERIFICATION_PENDING', 'VERIFIED'))
    SELECT
      (SELECT count(*) FROM plataforma.entity WHERE status = 'ACTIVE') AS entities_available,
      (SELECT count(*) FROM plataforma.attribute_catalog WHERE catalog_run_id = (SELECT id FROM plataforma.catalog_run ORDER BY computed_at DESC, id DESC LIMIT 1)) AS attributes_discovered,
      (SELECT count(*) FROM plataforma.growth_opportunity WHERE topic_id IS NOT NULL) AS topics_discovered,
      (SELECT count(*) FROM plataforma.combination_log) AS combinations_evaluated,
      (SELECT count(*) FROM latest_dec WHERE decision = 'READY_FOR_BLUEPRINT') AS opportunities_eligible,
      (SELECT count(DISTINCT opportunity_id) FROM plataforma.spec_blueprint) AS blueprints_created,
      (SELECT count(*) FROM plataforma.spec_blueprint) AS blueprint_versions,
      (SELECT count(*) FROM plataforma.pipeline_run WHERE status = 'RUNNING') AS pages_generating,
      (SELECT count(DISTINCT opportunity_id) FROM plataforma.page_recipe) AS pages_generated,
      (SELECT count(*) FROM plataforma.page_recipe) AS recipe_versions,
      (SELECT count(*) FROM plataforma.growth_opportunity WHERE status IN ('data_assembled', 'evidence_validated', 'experience_built')) AS pages_awaiting_qa,
      (SELECT count(*) FROM latest_qa WHERE outcome = 'QA_PASSED') AS pages_qa_passed,
      (SELECT count(*) FROM latest_qa q JOIN latest_recipe lr ON lr.opportunity_id = q.opportunity_id LEFT JOIN latest_appr a ON a.recipe_id = lr.recipe_id WHERE q.outcome = 'QA_PASSED' AND q.recipe_id = lr.recipe_id AND a.decision IS NULL) AS pages_awaiting_approval,
      (SELECT count(*) FROM latest_recipe lr JOIN latest_appr a ON a.recipe_id = lr.recipe_id WHERE a.decision = 'APPROVED') AS pages_approved,
      (SELECT count(DISTINCT opportunity_id) FROM dep_pages WHERE target = 'preview') AS pages_deployed_preview,
      (SELECT count(DISTINCT opportunity_id) FROM dep_pages WHERE target = 'production') AS pages_published,
      (SELECT count(*) FROM latest_gate WHERE eligible_approval) AS pages_gate_approval,
      (SELECT count(*) FROM latest_gate WHERE eligible_indexing) AS pages_gate_indexing,
      (SELECT count(*) FROM latest_gate WHERE failed_rules ? 'INSUFFICIENT_CONTEXTUAL_INLINKS') AS pages_insufficient_inlinks,
      (SELECT count(*) FROM latest_gate WHERE jsonb_array_length(coalesce(result -> 'intentConflicts', '[]'::jsonb)) > 0 AND EXISTS (SELECT 1 FROM jsonb_array_elements(result -> 'intentConflicts') c WHERE c ->> 'severity' = 'conflict')) AS intent_conflicts,
      (SELECT count(*) FROM latest_obs WHERE state = 'INDEXED') AS pages_indexed,
      (SELECT count(*) FROM plataforma.indexation_observation) AS observations_total,
      (SELECT count(*) FROM plataforma.deployment) AS deployments_total,
      (SELECT count(*) FROM plataforma.deployment WHERE status = 'VERIFIED') AS deployments_verified,
      (SELECT count(*) FROM latest_run WHERE final_outcome = 'BLOCKED') AS pages_blocked,
      (SELECT count(*) FROM plataforma.pipeline_run WHERE status = 'FAILED' AND created_at >= now() - make_interval(days => $1)) + (SELECT count(*) FROM plataforma.agent_run WHERE status IN ('failed', 'invalid_output', 'timed_out') AND created_at >= now() - make_interval(days => $1)) AS generation_failures,
      (SELECT count(*) FROM plataforma.pipeline_run WHERE status = 'FAILED' AND created_at >= now() - make_interval(days => $1 * 2) AND created_at < now() - make_interval(days => $1)) + (SELECT count(*) FROM plataforma.agent_run WHERE status IN ('failed', 'invalid_output', 'timed_out') AND created_at >= now() - make_interval(days => $1 * 2) AND created_at < now() - make_interval(days => $1)) AS generation_failures_prev,
      (SELECT count(*) FROM plataforma.pipeline_run WHERE created_at >= now() - make_interval(days => $1)) AS pipeline_runs,
      (SELECT count(*) FROM plataforma.pipeline_run WHERE created_at >= now() - make_interval(days => $1 * 2) AND created_at < now() - make_interval(days => $1)) AS pipeline_runs_prev
  `, [days])).rows[0]!;
  const values: Record<string, MetricValue> = {};
  for (const m of METRICS) {
    if (m.id === "pages_indexed" && Number(r.observations_total) === 0) { values[m.id] = { state: "not_instrumented", reason: NOT_INSTRUMENTED_REASON }; continue; }
    values[m.id] = { state: "available", value: Number(r[m.id]), previous: m.kind === "period_events" || m.kind === "attempts" ? Number(r[`${m.id}_prev`] ?? 0) : null };
  }
  return { asOf: new Date(), periodDays: days, values };
}
