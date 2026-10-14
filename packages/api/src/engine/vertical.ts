// Contrato de VERTICAL (ADR-023, seção 8): o núcleo é genérico; cada vertical declara entidades, intenções, estágios, padrões de query, regras de sinal,
// requisitos de evidência, experiências, pesos de score e elegibilidade. O núcleo não conhece nenhum domínio: ele só valida e executa esta definição.
import type { ScoreConfig } from "./score-config";

export interface IntentDef {
  readonly id: string; readonly label: string;
  /** 0..1: quanto esta intenção vale para o negócio da vertical (configurado pela vertical, não medido). */
  readonly commercialWeight: number;
  /** 0..1: proximidade de uma conversão. */
  readonly conversionProximity: number;
}
export interface StageDef { readonly id: string; readonly label: string; readonly order: number; readonly conversionProximity: number }
export type ValueTier = "high" | "medium" | "low";
export interface QueryPattern {
  readonly key: string;
  /** Tema do padrão (liga sinais a padrões). */
  readonly group: string;
  readonly intent: string;
  readonly stage: string;
  /** `{entity}` ocupa o nome da entidade (ex.: uma cidade). `null` = padrão sem entidade. */
  readonly entityKind: string | null;
  /** O primeiro é a query principal; os demais são variações da MESMA intenção. */
  readonly templates: readonly string[];
  readonly jtbd: string;
  readonly experience: string;
  readonly valueTier: ValueTier;
  /** Ids de `evidenceRequirements` necessários para uma experiência fundamentada. */
  readonly requiredEvidence: readonly string[];
  readonly outcome: string;
  /** Padrão que só o motor de tópicos usa: a descoberta por padrão × entidade do motor anterior o ignora (ADR-030). */
  readonly topicOnly?: boolean;
}
export interface SignalRule {
  readonly topic: string; readonly label: string;
  /** Palavras (sem acento, minúsculas) que, presentes num título ou resumo, ligam o sinal ao tema. */
  readonly keywords: readonly string[];
  /** Indicadores (ex.: `bcb-sgs:432`) que também pertencem ao tema. */
  readonly indicators: readonly string[];
  /** `group` dos padrões que este tema influencia. */
  readonly groups: readonly string[];
  readonly explain: string;
}
export type RequirementWeight = "critical" | "important" | "optional";
export interface EvidenceRequirement {
  readonly id: string; readonly label: string; readonly weight: RequirementWeight;
  /** O que satisfaz o requisito: `entities` (dados do tenant), `indicator:<fonte>` (indicador observado) ou `source:<id>` (fonte ainda inexistente). */
  readonly satisfiedBy: readonly string[];
  readonly note: string;
}
export type ExperienceStatus = "supported" | "planned" | "unsupported";
export interface ExperienceDef {
  readonly id: string; readonly label: string; readonly status: ExperienceStatus; readonly note: string;
  /** Chaves de template de página já existentes no sistema que atendem esta experiência (para medir canibalização). */
  readonly servedByTemplates?: readonly string[];
}

/** Que fontes públicas consultar para esta vertical (o núcleo só executa; quem decide o que é relevante é a vertical). */
export interface SourceConfig {
  /** Séries do Banco Central (SGS): id da série, rótulo, unidade e periodicidade. */
  readonly bcbSeries: readonly { readonly id: number; readonly label: string; readonly unit: string; readonly frequency: "daily" | "monthly"; readonly topic: string }[];
  /** Termos de busca na API de notícias do IBGE. */
  readonly ibgeSearchTerms: readonly string[];
  /** Feeds RSS públicos (HTTPS). */
  readonly rssFeeds: readonly { readonly id: string; readonly label: string; readonly url: string }[];
}

export interface ScopeDef { readonly id: string; readonly label: string; readonly entityKind: string; /** Códigos oficiais (ex.: IBGE) das entidades do escopo. */ readonly entityCodes: readonly string[] }
export interface VerticalDefinition {
  readonly id: string; readonly name: string; readonly language: string; readonly country: string;
  readonly entityKinds: readonly string[];
  readonly intents: readonly IntentDef[];
  readonly stages: readonly StageDef[];
  readonly patterns: readonly QueryPattern[];
  readonly signals: readonly SignalRule[];
  readonly evidenceRequirements: readonly EvidenceRequirement[];
  readonly experiences: readonly ExperienceDef[];
  /** Palavras-chave de relevância para filtrar notícias e feeds (sem acento, minúsculas). */
  readonly relevanceKeywords: readonly string[];
  readonly sources: SourceConfig;
  /** Sinônimos (forma normalizada → forma canônica) aplicados às queries e aos modelos antes de comparar (ex.: abreviações do domínio). */
  readonly synonyms?: Readonly<Record<string, string>>;
  /** Escopos de pesquisa nomeados (ex.: um piloto por cidade). Um escopo só recorta entidades do tenant; não cria nem inventa entidades ausentes. */
  readonly scopes?: readonly ScopeDef[];
  /** Configuração de score padrão desta vertical (a versão 1 de cada tenant nasce dela). */
  readonly scoring: ScoreConfig;
}

const inRange = (x: number) => Number.isFinite(x) && x >= 0 && x <= 1;

/** Valida a definição inteira e devolve TODOS os problemas (lista vazia = válida). Nada é corrigido em silêncio. */
export function validateVertical(v: VerticalDefinition): string[] {
  const e: string[] = [];
  const dup = (what: string, ids: readonly string[]) => { const s = new Set<string>(); for (const i of ids) { if (s.has(i)) e.push(`${what} duplicado: ${i}`); s.add(i); } };
  if (!/^[a-z][a-z0-9-]{2,40}$/.test(v.id)) e.push("id da vertical inválido");
  if (v.entityKinds.length === 0) e.push("a vertical precisa de ao menos um tipo de entidade");
  dup("intenção", v.intents.map((i) => i.id)); dup("estágio", v.stages.map((s) => s.id)); dup("padrão", v.patterns.map((p) => p.key));
  dup("requisito de evidência", v.evidenceRequirements.map((r) => r.id)); dup("experiência", v.experiences.map((x) => x.id)); dup("sinal", v.signals.map((s) => s.topic));
  for (const i of v.intents) if (!inRange(i.commercialWeight) || !inRange(i.conversionProximity)) e.push(`intenção ${i.id}: pesos fora de 0..1`);
  for (const s of v.stages) if (!inRange(s.conversionProximity) || !Number.isInteger(s.order) || s.order < 0) e.push(`estágio ${s.id}: ordem ou proximidade inválida`);
  const intents = new Set(v.intents.map((i) => i.id)), stages = new Set(v.stages.map((s) => s.id)), reqs = new Set(v.evidenceRequirements.map((r) => r.id)), exps = new Set(v.experiences.map((x) => x.id)), kinds = new Set(v.entityKinds);
  const groups = new Set(v.patterns.map((p) => p.group));
  for (const p of v.patterns) {
    const at = `padrão ${p.key}`;
    if (!intents.has(p.intent)) e.push(`${at}: intenção desconhecida (${p.intent})`);
    if (!stages.has(p.stage)) e.push(`${at}: estágio desconhecido (${p.stage})`);
    if (p.entityKind !== null && !kinds.has(p.entityKind)) e.push(`${at}: tipo de entidade desconhecido (${p.entityKind})`);
    if (p.templates.length === 0) e.push(`${at}: sem modelos de query`);
    for (const t of p.templates) {
      const slots = (t.match(/\{entity\}/g) ?? []).length;
      if (p.entityKind === null && slots > 0) e.push(`${at}: modelo com {entity} mas sem entidade (${t})`);
      if (p.entityKind !== null && slots !== 1) e.push(`${at}: o modelo precisa ter exatamente um {entity} (${t})`);
      if (/\{(?!entity\})[^}]*\}/.test(t)) e.push(`${at}: modelo com campo desconhecido (${t})`);
    }
    if (!exps.has(p.experience)) e.push(`${at}: experiência desconhecida (${p.experience})`);
    for (const r of p.requiredEvidence) if (!reqs.has(r)) e.push(`${at}: requisito de evidência desconhecido (${r})`);
    if (p.requiredEvidence.length === 0) e.push(`${at}: precisa exigir ao menos um requisito de evidência`);
  }
  for (const s of v.signals) {
    if (s.keywords.length === 0 && s.indicators.length === 0) e.push(`sinal ${s.topic}: sem palavras-chave nem indicadores`);
    for (const g of s.groups) if (!groups.has(g)) e.push(`sinal ${s.topic}: grupo sem padrões (${g})`);
  }
  if (v.relevanceKeywords.length === 0) e.push("a vertical precisa de palavras-chave de relevância");
  dup("série do BCB", v.sources.bcbSeries.map((x) => String(x.id))); dup("feed", v.sources.rssFeeds.map((x) => x.id));
  for (const b of v.sources.bcbSeries) if (!Number.isInteger(b.id) || b.id <= 0) e.push(`série do BCB inválida (${b.id})`);
  for (const f of v.sources.rssFeeds) if (!/^https:\/\//.test(f.url)) e.push(`feed ${f.id}: só HTTPS`);
  const topics = new Set(v.signals.map((x) => x.topic));
  for (const b of v.sources.bcbSeries) if (!topics.has(b.topic)) e.push(`série ${b.id}: tema sem regra de sinal (${b.topic})`);
  dup("escopo", (v.scopes ?? []).map((x) => x.id));
  for (const sc of v.scopes ?? []) {
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(sc.id)) e.push(`escopo ${sc.id}: id inválido`);
    if (!kinds.has(sc.entityKind)) e.push(`escopo ${sc.id}: tipo de entidade desconhecido (${sc.entityKind})`);
    if (sc.entityCodes.length === 0 || new Set(sc.entityCodes).size !== sc.entityCodes.length || sc.entityCodes.some((c) => c.trim() === "")) e.push(`escopo ${sc.id}: códigos de entidade vazios ou repetidos`);
  }
  return e;
}
