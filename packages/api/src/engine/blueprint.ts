import { createHash } from "node:crypto";
import type { EntityRecord } from "./entities";
import type { VerticalDefinition } from "./vertical";

// Blueprint de página (ADR-024): o plano verificável de uma oportunidade, derivado SÓ de dados já persistidos. Puro e determinístico: o mesmo insumo gera o
// mesmo conteúdo e o mesmo hash (nenhum horário entra no conteúdo). Genérico: não conhece domínio; os templates entram pelo registro.
export interface TemplateSectionInfo { readonly id: string; readonly label: string; /** Um parágrafo é gerado se TODOS os fatos dele existirem. */ readonly paragraphs: readonly { readonly requires: readonly string[] }[] }
export interface TemplateInfo {
  readonly key: string; readonly version: number; readonly entityKind: string; readonly requiredFacts: readonly string[]; readonly knownFacts: readonly string[];
  readonly sections: readonly TemplateSectionInfo[];
  /** Tipos de dados estruturados (schema.org) que o conteúdo sustenta. Só proposta: nada é emitido nesta fatia. */
  readonly structuredData: readonly string[];
  /** Caminho (URL) que a página teria para a entidade, ou `null` se faltarem dados. */
  readonly pathFor: (entity: { readonly name: string; readonly qualifier: string | null }) => string | null;
  /** Links internos que a página teria (destino e texto); só valem se o destino existir no site. */
  readonly linksFor: (entity: { readonly name: string; readonly qualifier: string | null }) => readonly { readonly path: string; readonly text: string }[];
}

export interface BlueprintOpportunity {
  readonly id: string; readonly primaryQuery: string; readonly intent: string; readonly stage: string; readonly pattern: string; readonly experience: string; readonly expectedOutcome: string;
  /** Resultado da elegibilidade no score mais recente, e qual score é. */
  readonly eligible: boolean | null; readonly scoreId: string | null;
  readonly entity: EntityRecord | null;
}
export interface BlueprintInput {
  readonly vertical: VerticalDefinition; readonly opportunity: BlueprintOpportunity; readonly templates: readonly TemplateInfo[];
  /** O que existe: `entities`, `indicator:<sourceRef>`. */
  readonly available: ReadonlySet<string>;
  /** Fatos conhecidos da entidade (valores nulos = ausentes); `null` = a entidade não tem fatos (ou não há entidade). */
  readonly entityFacts: Readonly<Record<string, string | number | null>> | null;
  /** Caminhos de páginas já geradas para OUTRAS entidades. */
  readonly existingPaths: ReadonlySet<string>;
  /** TODOS os caminhos que existem no site do tenant (destinos válidos de link interno). */
  readonly knownPaths: ReadonlySet<string>;
  /** Risco de canibalização medido (0..1) ou `null` (não medido) e o máximo aceito pela configuração do score. */
  readonly cannibalizationRisk: number | null; readonly maxCannibalizationRisk: number;
}

export type TemplateSelection =
  | { readonly status: "selected"; readonly key: string; readonly version: number; readonly reason: string }
  | { readonly status: "missing" | "entity_mismatch"; readonly key: null; readonly version: null; readonly reason: string };
export type DataStatus = "available" | "partial" | "missing";
export interface BlueprintRequirement { readonly id: string; readonly label: string; readonly weight: "critical" | "important" | "optional"; readonly satisfied: boolean; readonly by: string | null; readonly note: string }
export interface BlueprintSection { readonly id: string; readonly label: string; readonly data: DataStatus; readonly requires: readonly string[]; readonly missingFacts: readonly string[] }
export interface Blueprint {
  readonly schema: "blueprint/v1";
  readonly opportunity: { readonly id: string; readonly query: string; readonly intent: string; readonly stage: string; readonly pattern: string; readonly expectedOutcome: string; readonly eligible: boolean | null; readonly scoreId: string | null };
  readonly entity: { readonly kind: string; readonly id: string; readonly name: string; readonly qualifier: string | null } | null;
  readonly experience: { readonly id: string; readonly label: string; readonly status: string; readonly note: string };
  readonly template: TemplateSelection;
  readonly requirements: readonly BlueprintRequirement[];
  readonly sections: readonly BlueprintSection[];
  readonly answerFirst: { readonly available: boolean; readonly sectionId: string | null; readonly facts: readonly string[]; readonly reason: string };
  readonly factsProvenance: boolean;
  readonly structuredData: readonly string[];
  readonly path: { readonly proposed: string | null; readonly conflict: boolean };
  readonly internalLinks: readonly { readonly path: string; readonly text: string; readonly resolves: boolean }[];
  readonly cannibalization: { readonly risk: number | null; readonly max: number };
  readonly indexing: "noindex_until_published";
  readonly limitations: readonly string[];
}

const LIMITATIONS = [
  "A SERP não foi analisada (não há provedor de SERP): formato e concorrência não foram confrontados com os resultados reais.",
  "Demanda de busca não medida: o blueprint planeja a página, não prevê tráfego.",
  "Dados estruturados são só propostos; nenhum JSON-LD é emitido nesta etapa.",
  "Páginas externas do site atual não foram analisadas para canibalização.",
] as const;

export function buildBlueprint(input: BlueprintInput): Blueprint {
  const { vertical, opportunity: o } = input;
  const pattern = vertical.patterns.find((p) => p.key === o.pattern);
  const exp = vertical.experiences.find((e) => e.id === o.experience);
  if (!pattern || !exp) throw new TypeError(`padrão ou experiência desconhecidos na vertical: ${o.pattern} / ${o.experience}`);

  // template: precisa servir a experiência E o tipo da entidade
  const served = exp.servedByTemplates ?? [];
  const candidates = input.templates.filter((t) => served.includes(t.key));
  let template: TemplateSelection;
  let chosen: TemplateInfo | undefined;
  if (candidates.length === 0) template = { status: "missing", key: null, version: null, reason: `a experiência "${exp.label}" não tem template no registro (${exp.status === "supported" ? "declarada como suportada, mas sem template" : exp.note || "planejada"})` };
  else {
    chosen = candidates.find((t) => o.entity !== null && t.entityKind === o.entity.kind);
    template = chosen
      ? { status: "selected", key: chosen.key, version: chosen.version, reason: `template ${chosen.key} v${chosen.version} atende a experiência "${exp.label}" para entidades do tipo ${chosen.entityKind}` }
      : { status: "entity_mismatch", key: null, version: null, reason: o.entity === null ? `o template exige uma entidade do tipo ${candidates[0]!.entityKind} e a oportunidade não tem entidade` : `os templates disponíveis (${candidates.map((t) => t.key).join(", ")}) não atendem entidades do tipo ${o.entity.kind}` };
  }

  const requirements: BlueprintRequirement[] = pattern.requiredEvidence.map((id) => {
    const r = vertical.evidenceRequirements.find((x) => x.id === id)!;
    const by = r.satisfiedBy.find((t) => input.available.has(t)) ?? null;
    return { id: r.id, label: r.label, weight: r.weight, satisfied: by !== null, by, note: r.note };
  });

  const facts = input.entityFacts ?? {};
  const has = (k: string) => facts[k] !== undefined && facts[k] !== null;
  const sections: BlueprintSection[] = chosen
    ? chosen.sections.map((s) => {
        const ok = s.paragraphs.filter((p) => p.requires.every(has)).length;
        const requires = [...new Set(s.paragraphs.flatMap((p) => p.requires))];
        return { id: s.id, label: s.label, data: ok === s.paragraphs.length ? "available" : ok === 0 ? "missing" : "partial", requires, missingFacts: requires.filter((k) => !has(k)) } as BlueprintSection;
      })
    : [];

  const first = chosen?.sections[0]?.paragraphs[0];
  const answerFirst = chosen && first
    ? { available: first.requires.every(has), sectionId: chosen.sections[0]!.id, facts: first.requires, reason: first.requires.every(has) ? "o primeiro parágrafo responde com fatos da própria entidade" : `faltam fatos para o primeiro parágrafo: ${first.requires.filter((k) => !has(k)).join(", ")}` }
    : { available: false, sectionId: null, facts: [] as string[], reason: "sem template selecionado, não há bloco de resposta direta" };

  const proposed = chosen && o.entity ? chosen.pathFor({ name: o.entity.name, qualifier: o.entity.qualifier }) : null;
  return {
    schema: "blueprint/v1",
    opportunity: { id: o.id, query: o.primaryQuery, intent: o.intent, stage: o.stage, pattern: o.pattern, expectedOutcome: o.expectedOutcome, eligible: o.eligible, scoreId: o.scoreId },
    entity: o.entity ? { kind: o.entity.kind, id: o.entity.id, name: o.entity.name, qualifier: o.entity.qualifier } : null,
    experience: { id: exp.id, label: exp.label, status: exp.status, note: exp.note },
    template, requirements, sections, answerFirst,
    factsProvenance: input.entityFacts !== null && Object.values(input.entityFacts).some((v) => v !== null),
    structuredData: chosen?.structuredData ?? [],
    path: { proposed, conflict: proposed !== null && input.existingPaths.has(proposed) },
    internalLinks: chosen && o.entity ? chosen.linksFor({ name: o.entity.name, qualifier: o.entity.qualifier }).map((l) => ({ path: l.path, text: l.text, resolves: input.knownPaths.has(l.path) })) : [],
    cannibalization: { risk: input.cannibalizationRisk, max: input.maxCannibalizationRisk },
    indexing: "noindex_until_published",
    limitations: LIMITATIONS,
  };
}

const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v);
export const blueprintHash = (b: Blueprint): string => createHash("sha256").update(JSON.stringify(canon(b))).digest("hex");
