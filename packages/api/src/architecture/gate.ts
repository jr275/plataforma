import type { JsonLdValidation } from "./jsonld";
import type { IntentConflict } from "./intents";
import type { InlinkEvaluation } from "./links";
import type { ArchetypeContract, ValidationResult } from "./types";

// Quality Gate de arquitetura (função PURA): 10 passos determinísticos e um resultado estruturado com QUATRO eligibilidades separadas — qualidade, aprovação, publicação, indexação — e, fora daqui, o estado de
// indexação OBSERVADO (só uma medição real afirma isso). Cada regra declara o que bloqueia. Gate aprovado não prova indexação; página aprovada não está publicada.
export type Level = "approval" | "publication" | "indexing";
export type StepStatus = "PASSED" | "FAILED" | "WARNING" | "SKIPPED";
export interface GateRule { readonly id: string; readonly step: number; readonly passed: boolean; readonly blocks: readonly Level[]; readonly severity: "block" | "warning"; readonly message: string; readonly evidence?: unknown }
export interface GateStep { readonly n: number; readonly id: string; readonly name: string; readonly status: StepStatus; readonly rules: readonly GateRule[] }
export interface GateInput {
  readonly archetype: ArchetypeContract; readonly validation: ValidationResult; readonly conflicts: readonly IntentConflict[];
  readonly entity: { readonly primaryEntityId: string | null; readonly relationsCount: number | null };
  readonly template: { readonly blueprintStatus: string | null; readonly templateAvailable: boolean; readonly templateGap: boolean; readonly omittedModules: readonly { readonly moduleId: string; readonly reason: string }[]; readonly unknownModules: readonly string[] };
  readonly links: { readonly inlinks: InlinkEvaluation | null; readonly outlinksValid: number; readonly outlinksInvalid: number; readonly graphHash: string | null };
  readonly canonical: { readonly url: string | null; readonly canonical: string | null; readonly rule: "self" | "parent" | "none"; readonly indexabilityPolicy: "index" | "noindex" | null };
  readonly schema: JsonLdValidation | null;
  readonly content: { readonly qaOutcome: "QA_PASSED" | "QA_FAILED" | "QA_INCOMPLETE" | null; readonly blocking: readonly string[]; readonly notRun: readonly string[] };
  readonly approval: "APPROVED" | "REJECTED" | "REVOKED" | null;
}
export interface GateResult {
  readonly archetypeId: string; readonly contractVersion: string; readonly steps: readonly GateStep[];
  readonly passedRules: readonly string[]; readonly failedRules: readonly string[]; readonly warnings: readonly string[]; readonly missingData: readonly string[];
  readonly linkProblems: readonly { readonly rule: string; readonly detail: unknown }[]; readonly intentConflicts: readonly IntentConflict[]; readonly schemaErrors: readonly string[];
  readonly qualityScore: number | null;
  readonly eligibility: { readonly approval: boolean; readonly publication: boolean; readonly indexing: boolean };
  /** Por que cada nível não está liberado (ids das regras que o bloqueiam). */ readonly blockedBy: { readonly approval: readonly string[]; readonly publication: readonly string[]; readonly indexing: readonly string[] };
  readonly nextActions: readonly string[];
}
const ACTION: Record<string, string> = {
  "INSUFFICIENT_CONTEXTUAL_INLINKS": "Criar links contextuais válidos de páginas do mesmo cluster/pai (veja as sugestões) até atingir o mínimo da política",
  "contract.schema": "Corrigir os campos do dado que não passam no schema do archetype",
  "contract.generation": "Completar os dados obrigatórios do archetype para gerar a página",
  "contract.indexing": "Completar os dados exigidos para indexação (veja dados ausentes e proveniência)",
  "contract.density": "Aumentar a densidade de dados até o limiar do archetype (veja os sinais não atingidos)",
  "intent.conflict": "Resolver o conflito de intenção: consolidar, diferenciar, mudar a intenção ou ajustar a canonicalização",
  "template.ready": "Fechar o blueprint e usar um template existente para o archetype",
  "canonical.valid": "Ajustar a URL/canonical conforme a regra do archetype",
  "schema.hierarchy": "Criar as páginas-pai do breadcrumb (hierarquia real) ou remover o BreadcrumbList do JSON-LD",
  "schema.valid": "Corrigir o JSON-LD (tipos do contrato, ids únicos, ofertas só com dados reais)",
  "content.qa": "Passar nos gates de QA de conteúdo (Q1–Q14) com a versão atual do recipe",
  "approval.human": "Registrar a aprovação humana da versão atual do recipe",
  "policy.index": "O blueprint declara noindex: mudar a política de indexação só com decisão explícita",
};
const R = (id: string, step: number, passed: boolean, blocks: Level[], message: string, evidence?: unknown, severity: GateRule["severity"] = "block"): GateRule => ({ id, step, passed, blocks, severity, message, ...(evidence !== undefined ? { evidence } : {}) });
const status = (rules: readonly GateRule[]): StepStatus => (rules.length === 0 ? "SKIPPED" : rules.some((r) => !r.passed && r.severity === "block") ? "FAILED" : rules.some((r) => !r.passed) ? "WARNING" : "PASSED");

export function runGate(i: GateInput): GateResult {
  const v = i.validation; const schemaFailed = v.issues.some((x) => x.layer === "schema");
  const s1: GateRule[] = [
    R("contract.schema", 1, !schemaFailed, ["approval", "publication", "indexing"], "Dado válido no schema do archetype", schemaFailed ? v.issues.filter((x) => x.layer === "schema").map((x) => `${x.path}: ${x.message}`) : undefined),
    R("contract.generation", 1, v.isValidForGeneration, ["approval", "publication", "indexing"], "Dados mínimos para gerar a página", v.issues.filter((x) => x.severity === "block_generation" && x.layer !== "schema").map((x) => x.id)),
    R("contract.indexing", 1, v.isValidForIndexing, ["indexing"], "Dados e proveniência exigidos para indexação", v.issues.filter((x) => x.severity === "block_indexing" && x.layer !== "eligibility").map((x) => ({ id: x.id, evidence: x.evidence }))),
    R("contract.density", 1, v.score !== null && v.density !== null && v.score >= v.density.threshold, ["indexing"], `Densidade ${v.score ?? "n/d"} (mínimo ${v.density?.threshold ?? "n/d"})`, v.density),
  ];
  const hard = i.conflicts.filter((c) => c.severity === "conflict"); const signals = i.conflicts.filter((c) => c.severity === "signal");
  const s2: GateRule[] = [R("intent.conflict", 2, hard.length === 0, ["approval", "publication", "indexing"], hard.length ? `${hard.length} conflito(s) de intenção/URL` : "Sem conflito de intenção", hard.map((c) => ({ kind: c.kind, action: c.recommendedAction, pages: c.pages.map((p) => p.id) }))), R("intent.overlap_signal", 2, signals.length === 0, [], signals.length ? `${signals.length} sinal(is) de sobreposição para investigar` : "Sem sinais de sobreposição", signals.map((c) => c.kind), "warning")];
  const s3: GateRule[] = [R("entity.primary", 3, i.entity.primaryEntityId !== null, ["approval", "publication", "indexing"], "Entidade principal identificada", { primaryEntityId: i.entity.primaryEntityId }), ...(i.entity.relationsCount === null ? [] : [R("entity.relations", 3, i.entity.relationsCount > 0, [], "A entidade tem relações no grafo", { relations: i.entity.relationsCount }, "warning")])];
  const t = i.template;
  const s4: GateRule[] = [R("template.ready", 4, t.blueprintStatus === "COMPLETE" && t.templateAvailable && !t.templateGap && t.unknownModules.length === 0, ["approval", "publication", "indexing"], "Blueprint completo, template existente e módulos dentro do contrato", { blueprint: t.blueprintStatus, templateAvailable: t.templateAvailable, templateGap: t.templateGap, unknownModules: t.unknownModules }), R("template.omitted_modules", 4, t.omittedModules.length === 0, [], t.omittedModules.length ? `${t.omittedModules.length} módulo(s) omitido(s) por falta de dados` : "Todos os módulos renderizados", t.omittedModules, "warning")];
  const g = i.links; const inl = g.inlinks;
  const s5: GateRule[] = [R("graph.compiled", 5, g.graphHash !== null, ["indexing"], g.graphHash ? "Grafo de links compilado" : "Grafo de links não compilado", { graphHash: g.graphHash })];
  const s6: GateRule[] = [R("INSUFFICIENT_CONTEXTUAL_INLINKS", 6, inl?.passed ?? false, ["indexing"], inl ? `${inl.valid} de ${inl.required} inlinks contextuais válidos${inl.exception ? " (exceção explícita aplicada)" : ""}` : "Inlinks não avaliados", inl ? { required: inl.required, valid: inl.valid, missing: inl.missing, exception: inl.exception, rejected: inl.rejected.map((e) => ({ from: e.fromId, reason: e.invalidReason })), suggestions: inl.suggestions } : undefined), R("links.outlinks_valid", 6, g.outlinksInvalid === 0, [], g.outlinksInvalid ? `${g.outlinksInvalid} outlink(s) inválido(s)` : "Outlinks válidos", { valid: g.outlinksValid, invalid: g.outlinksInvalid }, "warning")];
  const c = i.canonical; const canonOk = c.url !== null && (c.rule === "none" || (c.rule === "self" ? c.canonical === c.url : c.canonical !== null));
  const s7: GateRule[] = [R("canonical.valid", 7, canonOk, ["approval", "publication", "indexing"], "URL e canonical coerentes com a regra do archetype", { url: c.url, canonical: c.canonical, rule: c.rule })];
  const sc = i.schema;
  const hier = sc ? sc.issues.filter((x) => x.rule === "jsonld.breadcrumb_without_hierarchy") : []; const schemaIssues = sc ? sc.issues.filter((x) => x.rule !== "jsonld.breadcrumb_without_hierarchy") : [];
  const s8: GateRule[] = [R("schema.valid", 8, sc !== null && schemaIssues.length === 0, ["approval", "publication", "indexing"], sc ? (schemaIssues.length === 0 ? "JSON-LD válido para o archetype" : "JSON-LD inválido") : "JSON-LD não validado", sc ? schemaIssues : undefined), ...(sc ? [R("schema.hierarchy", 8, hier.length === 0, ["indexing"], hier.length ? "BreadcrumbList aponta para uma hierarquia que não existe (páginas-pai ausentes)" : "Breadcrumb coerente com a hierarquia", hier)] : []), ...(sc && sc.warnings.length ? [R("schema.warnings", 8, false, [], `${sc.warnings.length} aviso(s) de coerência do JSON-LD`, sc.warnings, "warning")] : [])];
  const q = i.content;
  const s9: GateRule[] = [R("content.qa", 9, q.qaOutcome === "QA_PASSED", ["approval", "publication", "indexing"], q.qaOutcome ? `QA de conteúdo: ${q.qaOutcome}` : "QA de conteúdo não executado", { blocking: q.blocking, notRun: q.notRun })];
  const s10: GateRule[] = [R("approval.human", 10, i.approval === "APPROVED", ["publication", "indexing"], i.approval ? `Aprovação humana: ${i.approval}` : "Sem aprovação humana", { decision: i.approval }), R("policy.index", 10, c.indexabilityPolicy === "index", ["indexing"], c.indexabilityPolicy === "index" ? "A política do blueprint permite indexação" : "O blueprint declara noindex", { indexabilityPolicy: c.indexabilityPolicy })];
  const steps: GateStep[] = ([[1, "contract_data", "Contrato e dados", s1], [2, "intent_duplicates", "Intenção e duplicidade", s2], [3, "entity_relations", "Entidade principal e relações", s3], [4, "template_modules", "Template e módulos", s4], [5, "link_graph", "Grafo de links", s5], [6, "inlinks_outlinks", "Inlinks e outlinks", s6], [7, "canonical_urls", "Canonical e URLs", s7], [8, "schema_jsonld", "Schema.org e JSON-LD", s8], [9, "content_seo", "Conteúdo e SEO", s9], [10, "eligibility", "Elegibilidade", s10]] as const).map(([n, id, name, rules]) => ({ n, id, name, status: status(rules), rules }));
  const all = steps.flatMap((s) => s.rules); const failedBlock = all.filter((r) => !r.passed && r.severity === "block");
  const by = (l: Level) => failedBlock.filter((r) => r.blocks.includes(l)).map((r) => r.id);
  const blockedBy = { approval: by("approval"), publication: by("publication"), indexing: by("indexing") };
  const next = [...new Set(failedBlock.map((r) => ACTION[r.id] ?? ACTION[r.id.split(".")[0]!] ?? `Resolver a regra ${r.id}`))];
  return { archetypeId: i.archetype.id, contractVersion: i.archetype.version, steps, passedRules: all.filter((r) => r.passed).map((r) => r.id), failedRules: failedBlock.map((r) => r.id), warnings: all.filter((r) => !r.passed && r.severity === "warning").map((r) => r.id), missingData: v.missingData,
    linkProblems: [...(inl && !inl.passed ? [{ rule: "INSUFFICIENT_CONTEXTUAL_INLINKS", detail: { required: inl.required, valid: inl.valid, missing: inl.missing, suggestions: inl.suggestions } }] : []), ...(inl ? inl.rejected.map((e) => ({ rule: e.invalidReason ?? "INVALID", detail: { from: e.fromId, to: e.toPath } })) : [])], intentConflicts: i.conflicts, schemaErrors: sc ? sc.issues.map((x) => `${x.rule}: ${x.message}`) : [],
    qualityScore: v.score, eligibility: { approval: blockedBy.approval.length === 0, publication: blockedBy.publication.length === 0, indexing: blockedBy.indexing.length === 0 }, blockedBy, nextActions: next };
}
