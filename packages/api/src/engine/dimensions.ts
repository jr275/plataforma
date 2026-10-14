import type { EntityRecord } from "./entities";
import { DIMENSIONS, DIMENSION_INFO, type DimensionId, type ScoreConfig } from "./score-config";
import { unknownDimension, type DimensionMap, type DimensionValue } from "./score";
import type { QueryPattern, VerticalDefinition } from "./vertical";

// Deriva os valores das dimensões do score a partir do que o sistema REALMENTE sabe (vertical, dados do tenant, evidências coletadas, páginas existentes).
// Sem fonte, a dimensão fica `unknown` com a explicação do que falta. Nada é estimado aqui.
export interface PageFact { readonly entityId: string; readonly templateKey: string }
export interface DimensionContext {
  readonly def: VerticalDefinition; readonly config: ScoreConfig; readonly pattern: QueryPattern; readonly entity: EntityRecord | null;
  /** Rótulos do que existe: `entities`, `indicator:<sourceRef>`, `source:<id>` (nenhum, enquanto a fonte não existir). */
  readonly available: ReadonlySet<string>;
  /** Evidências que sustentam cada requisito (ids ou chaves). */
  readonly evidenceByRequirement: ReadonlyMap<string, readonly string[]>;
  /** `null` = o sistema não conhece as páginas do tenant (não dá para medir canibalização). */
  readonly pages: readonly PageFact[] | null;
}

const d = (id: DimensionId, value: number, source: string, note: string, extra: Partial<DimensionValue> = {}): DimensionValue => ({ id, value, basis: "derived", source, note, ...extra });

export function deriveDimensions(c: DimensionContext): DimensionMap {
  const { def, config, pattern: p } = c;
  const intent = def.intents.find((i) => i.id === p.intent)!;
  const stage = def.stages.find((s) => s.id === p.stage)!;
  const exp = def.experiences.find((e) => e.id === p.experience)!;
  const maxOrder = Math.max(...def.stages.map((s) => s.order), 1);
  const reqs = p.requiredEvidence.map((id) => def.evidenceRequirements.find((r) => r.id === id)!);
  const satisfied = reqs.filter((r) => r.satisfiedBy.some((t) => c.available.has(t)));
  const missing = reqs.filter((r) => !satisfied.includes(r));
  const vertical = `vertical:${def.id}`;

  const out: Record<DimensionId, DimensionValue> = Object.fromEntries(DIMENSIONS.map((id) => [id, unknownDimension(id, `sem dado: ${DIMENSION_INFO[id].needs}`)])) as Record<DimensionId, DimensionValue>;
  out.intent = d("intent", intent.commercialWeight, vertical, `intenção "${intent.label}" vale ${intent.commercialWeight} para o negócio (peso definido pela vertical, não medido)`);
  out.buyer_stage = d("buyer_stage", stage.order / maxOrder, vertical, `estágio "${stage.label}" (posição ${stage.order} de ${maxOrder}): mais adiante no funil, maior o valor`);
  out.business_value = d("business_value", config.categories.valueTier[p.valueTier], vertical, `valor "${p.valueTier}" atribuído pela vertical ao padrão ${p.key} (convertido pela tabela de categorias da configuração)`);
  out.conversion_proximity = d("conversion_proximity", (intent.conversionProximity + stage.conversionProximity) / 2, vertical, `média da proximidade de conversão da intenção (${intent.conversionProximity}) e do estágio (${stage.conversionProximity})`);
  out.solution_fit = d("solution_fit", config.categories.experienceStatus[exp.status], vertical, `a experiência "${exp.label}" está ${exp.status === "supported" ? "suportada" : exp.status === "planned" ? "planejada" : "não suportada"} na plataforma${exp.note ? `: ${exp.note}` : ""}`);

  const evIds = satisfied.flatMap((r) => c.evidenceByRequirement.get(r.id) ?? []);
  out.evidence_availability = d("evidence_availability", reqs.length === 0 ? 0 : satisfied.length / reqs.length, "sistema", `${satisfied.length} de ${reqs.length} requisitos de evidência atendidos${missing.length ? `; faltam: ${missing.map((m) => m.label).join(", ")}` : ""}`, { evidenceIds: evIds });
  const risk = missing.length === 0 ? 0.1 : Math.max(...missing.map((m) => config.categories.requirementRisk[m.weight]));
  out.evidence_risk = d("evidence_risk", risk, "sistema", missing.length === 0 ? "todos os requisitos atendidos: risco residual" : `risco pelo requisito mais pesado ausente (${missing.map((m) => `${m.label} [${m.weight}]`).join(", ")})`);

  if (c.pages !== null) {
    const served = exp.servedByTemplates ?? [];
    const overlap = c.entity !== null && c.pages.some((pg) => pg.entityId === c.entity!.id && served.includes(pg.templateKey));
    out.cannibalization_risk = d("cannibalization_risk", overlap ? config.categories.cannibalization.overlap : config.categories.cannibalization.none, "páginas do tenant",
      overlap ? `já existe uma página gerada para ${c.entity!.name} que atende a experiência "${exp.label}"` : "nenhuma página gerada atende esta entidade e experiência; páginas externas do site não foram analisadas", overlap ? {} : { uncertainty: 0.5 });
  }
  return out;
}
