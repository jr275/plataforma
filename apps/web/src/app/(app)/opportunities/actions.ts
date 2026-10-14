"use server";

import { TEMPLATE_REGISTRY, engine } from "@plataforma/api";
import { actionContext, explainFailure } from "@/lib/server/action-context";
import { activeVertical, realFetch, researchAdapters } from "@/lib/server/vertical";

// Ações do servidor do motor de oportunidades (ADR-023). Identidade e tenant SEMPRE da sessão; entradas validadas aqui; erros viram mensagens (nunca a do banco).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResearchState = { error?: string; fieldError?: string; result?: engine.ResearchResult } | null;
/** Inicia uma pesquisa REAL: consulta as fontes públicas, grava evidências e oportunidades e devolve o resumo da execução. Demora (segundos a um minuto). */
export async function researchAction(_prev: ResearchState, formData: FormData): Promise<ResearchState> {
  const raw = String(formData.get("entities") ?? "").trim();
  const entities = Number(raw);
  if (!/^\d+$/.test(raw) || entities < 1 || entities > 100) return { fieldError: "Informe um número inteiro de 1 a 100." };
  const c = await actionContext("research-action");
  if (!c.ok) return { error: c.message };
  try {
    const result = await engine.runResearch(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { vertical: activeVertical, adapters: researchAdapters, fetch: realFetch }, { entityLimit: entities });
    return { result };
  } catch (e) {
    if (e instanceof engine.ResearchBusyError) return { error: "Já existe uma pesquisa em andamento neste workspace. Aguarde ela terminar e tente de novo." };
    return { error: explainFailure("research-action", e) };
  }
}

export type OpportunityActionState = { error?: string; ok?: string } | null;

export async function transitionAction(_prev: OpportunityActionState, formData: FormData): Promise<OpportunityActionState> {
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID.test(opportunityId)) return { error: "Identificador de oportunidade inválido." };
  if (!engine.isState(from) || !engine.isState(to)) return { error: "Estado inválido." };
  if (reason.length < 3 || reason.length > 1000) return { error: "Explique o motivo em 3 a 1000 caracteres." };
  // Só o que não afirma trabalho feito pode ser registrado à mão; as demais etapas são registradas pelo fluxo que as realiza (ex.: o blueprint).
  if (engine.canTransition(from, to) && !engine.canTransitionManually(from, to)) return { error: `A etapa “${engine.STATE_LABEL[to]}” só é registrada pelo fluxo que a realiza (não pode ser marcada à mão).` };
  const c = await actionContext("transition-action");
  if (!c.ok) return { error: c.message };
  try {
    await engine.transitionOpportunity(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { opportunityId, from, to, reason });
    return { ok: `Estado alterado para “${engine.STATE_LABEL[to]}”.` };
  } catch (e) {
    if (e instanceof engine.LifecycleError) return { error: "Essa transição não é permitida pelo ciclo de vida." };
    if (e instanceof engine.StaleStateError) return { error: "O estado mudou enquanto você decidia. A página foi atualizada; confira e tente de novo." };
    if (e instanceof engine.OpportunityNotFoundError) return { error: "Oportunidade não encontrada neste workspace." };
    return { error: explainFailure("transition-action", e) };
  }
}

export async function rescoreAction(_prev: OpportunityActionState, formData: FormData): Promise<OpportunityActionState> {
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const raw = String(formData.get("configVersion") ?? "").trim();
  const configVersion = Number(raw);
  if (!UUID.test(opportunityId)) return { error: "Identificador de oportunidade inválido." };
  if (!/^\d+$/.test(raw) || configVersion < 1) return { error: "Escolha uma versão da configuração." };
  const c = await actionContext("rescore-action");
  if (!c.ok) return { error: c.message };
  try {
    const r = await engine.rescoreOpportunity(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { opportunityId, configVersion });
    return { ok: r.created ? `Novo score calculado com a configuração v${r.configVersion}.` : `Já existe um score desta oportunidade com a configuração v${r.configVersion}; nada mudou.` };
  } catch (e) {
    if (e instanceof engine.ConfigError) return { error: e.message };
    if (e instanceof engine.OpportunityNotFoundError) return { error: "Oportunidade não encontrada neste workspace." };
    if (e instanceof engine.StaleStateError) return { error: "Esta oportunidade ainda não tem um score para reavaliar." };
    return { error: explainFailure("rescore-action", e) };
  }
}

export type ConfigState = { error?: string; ok?: string; fieldErrors?: Record<string, string> } | null;
/** Salva uma NOVA versão da configuração do score a partir do formulário (pesos, cobertura mínima, limites de elegibilidade). A versão anterior permanece. */
export async function saveConfigAction(_prev: ConfigState, formData: FormData): Promise<ConfigState> {
  const c = await actionContext("config-action");
  if (!c.ok) return { error: c.message };
  const note = String(formData.get("note") ?? "").trim().slice(0, 300);
  const fieldErrors: Record<string, string> = {};
  const num = (name: string): number => {
    const raw = String(formData.get(name) ?? "").trim().replace(",", ".");
    const n = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(n) || n < 0) fieldErrors[name] = "Informe um número maior ou igual a zero.";
    return n;
  };
  let base: engine.ScoreConfig;
  try {
    base = (await engine.ensureActiveConfigFor(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, activeVertical)).config;
  } catch (e) { return { error: explainFailure("config-action", e) }; }
  const objectives = Object.fromEntries(engine.OBJECTIVES.map((o) => {
    const oc = base.objectives[o];
    const dimensions = Object.fromEntries(Object.keys(oc.dimensions).map((d) => [d, num(`dim.${o}.${d}`)]));
    return [o, { weight: num(`obj.${o}.weight`), minCoverage: num(`obj.${o}.minCoverage`), dimensions }];
  })) as unknown as engine.ScoreConfig["objectives"];
  const e = base.eligibility;
  const eligibility = { ...e, minCommercialValue: num("elig.minCommercialValue"), minExecutionFeasibility: num("elig.minExecutionFeasibility"), maxEvidenceRisk: num("elig.maxEvidenceRisk"), maxCannibalizationRisk: num("elig.maxCannibalizationRisk"), requireStrategicOrDemand: formData.get("elig.requireStrategicOrDemand") === "on" };
  const uncertaintyFactor = num("uncertaintyFactor");
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors, error: "Corrija os campos destacados." };
  const config: engine.ScoreConfig = { ...base, objectives, eligibility, uncertaintyFactor };
  const problems = engine.validateScoreConfig(config);
  if (problems.length > 0) return { error: `Configuração inválida: ${problems.join("; ")}` };
  try {
    const r = await engine.saveScoreConfig(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { verticalId: activeVertical.id, config, note: note || undefined });
    return { ok: r.created ? `Versão ${r.config.version} criada. Ela vale para as próximas pesquisas e reavaliações; os scores antigos permanecem.` : `Nada mudou: o conteúdo é igual ao da versão ${r.config.version}.` };
  } catch (e2) {
    if (e2 instanceof engine.ConfigError) return { error: e2.message };
    return { error: explainFailure("config-action", e2) };
  }
}

/** Gera o blueprint da oportunidade: plano de página, seis gates de experiência e, se nenhum reprovar, o avanço para "blueprinted" (SERP dispensada e registrada). */
export async function blueprintAction(_prev: OpportunityActionState, formData: FormData): Promise<OpportunityActionState> {
  const opportunityId = String(formData.get("opportunityId") ?? "");
  if (!UUID.test(opportunityId)) return { error: "Identificador de oportunidade inválido." };
  const c = await actionContext("blueprint-action");
  if (!c.ok) return { error: c.message };
  try {
    const r = await engine.createBlueprint(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { vertical: activeVertical, templates: TEMPLATE_REGISTRY }, { opportunityId });
    if (!r.created) return { ok: `Nada mudou: o blueprint v${r.record.version} continua válido para os dados atuais.` };
    if (r.transitioned) return { ok: `Blueprint v${r.record.version} pronto. A oportunidade avançou para “${engine.STATE_LABEL.blueprinted}”.` };
    return { ok: r.record.ready ? `Blueprint v${r.record.version} pronto. A SERP não foi analisada: para avançar, analise com um provedor ou registre a exceção.` : `Blueprint v${r.record.version} criado com ${r.record.report.blockers.length} bloqueio(s). A oportunidade não avançou; veja os gates abaixo.` };
  } catch (e) {
    if (e instanceof engine.BlueprintStateError) return { error: "O blueprint só pode ser criado para oportunidades elegíveis." };
    if (e instanceof engine.OpportunityNotFoundError) return { error: "Oportunidade não encontrada neste workspace." };
    if (e instanceof engine.StaleStateError) return { error: "O estado mudou enquanto o blueprint era criado. Atualize a página e tente de novo." };
    return { error: explainFailure("blueprint-action", e) };
  }
}

export async function serpWaiverAction(_prev: OpportunityActionState, formData: FormData): Promise<OpportunityActionState> {
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!UUID.test(opportunityId)) return { error: "Identificador de oportunidade inválido." };
  if (reason.length < 10 || reason.length > 1000) return { error: "Explique o motivo da exceção em 10 a 1000 caracteres." };
  if (formData.get("ack") !== "on") return { error: "Confirme que a exceção não autoriza publicação e será revisada quando houver um provedor de SERP." };
  const c = await actionContext("serp-waiver-action");
  if (!c.ok) return { error: c.message };
  try {
    const r = await engine.applySerpWaiver(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, { opportunityId, reason });
    return { ok: `Exceção registrada: a oportunidade avançou para “${engine.STATE_LABEL.blueprinted}” com o blueprint v${r.blueprintVersion}. A SERP segue como não avaliada e a exceção continua pendente de revisão.` };
  } catch (e) {
    if (e instanceof engine.WaiverError) return { error: e.message.charAt(0).toUpperCase() + e.message.slice(1) + "." };
    if (e instanceof engine.BlueprintStateError) return { error: "A exceção só vale para oportunidades no estado “Elegível”." };
    if (e instanceof engine.OpportunityNotFoundError) return { error: "Oportunidade não encontrada neste workspace." };
    if (e instanceof engine.StaleStateError) return { error: "O estado mudou enquanto a exceção era registrada. Atualize a página." };
    return { error: explainFailure("serp-waiver-action", e) };
  }
}
