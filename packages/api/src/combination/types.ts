import type { IntentType } from "../catalog/types";
import type { CommercialPotential, GeoGranularity } from "../topics/types";

// Combination Engine (spec seção 7): descobre oportunidades que uma lista de palavras-chave não revela, SEM enumerar o produto cartesiano. Núcleo genérico: dimensões, regras e espaço de dados vêm do pack.
export type Dims = Readonly<Record<string, string>>;
export interface CombinationPolicy {
  /** Máximo de dimensões de um candidato (padrão 4). */ readonly maxDimensions: number;
  /** Máximo para famílias de cauda longa (padrão 5). */ readonly longTailMaxDimensions: number;
  /** O filho só sobrevive se |filho| ≤ razão × |pai| (padrão 0,8). */ readonly redundancyRatio: number;
  /** ...e se tiver ao menos N blocos de dados que o pai não tem (padrão 1). */ readonly minExclusiveBlocks: number;
  /** Mínimo de itens no conjunto resultante, por chave de família (seção 15.5). */ readonly minItems: Readonly<Record<string, number>>;
  /** Teto de segurança de candidatos avaliados por execução: ao atingir, interrompe e REGISTRA (nunca trunca em silêncio). */ readonly maxCandidatesPerRun: number;
}
export interface DemandInfo { readonly value: number | null; readonly source: string | null; readonly period: string | null; readonly method: string | null; readonly uncertainty: string | null }
export interface CompatibilityRule { readonly id: string; readonly description: string; /** Devolve o motivo se a combinação NÃO pode existir. */ readonly check: (d: Dims) => string | null }

/** O espaço de dados de uma família: tudo que o motor precisa saber do mundo, sem conhecer o domínio. */
export interface Space {
  /** Valores candidatos da dimensão, dado o pai. */ values(dimensionId: string, parent: Dims): Promise<readonly string[]>;
  /** F2: a entidade existe e a geografia é coerente? Devolve o motivo de falha ou null. */ entityOk(dims: Dims): Promise<string | null>;
  /** Tamanho do conjunto resultante; null = dado desconhecido (nunca 0 por falta de dado). */ count(dims: Dims): Promise<number | null>;
  /** Blocos de dados que o filho tem e o pai não. */ exclusiveBlocks(child: Dims, parent: Dims): Promise<number>;
  demand(dims: Dims): Promise<DemandInfo | null>;
  /** Chave da intenção: candidatos com a mesma chave disputam a mesma busca (canibalização). */ intentKey(dims: Dims): string;
  /** Consulta-hipótese do candidato. */ describe(dims: Dims): string;
}
export interface FamilyChild {
  readonly queryPatternKey: string; readonly intentType: IntentType; readonly geoGranularity: GeoGranularity; readonly userNeed: string;
  readonly evidenceRequired: readonly string[]; readonly commercialPotential: CommercialPotential; readonly attributesUsed: readonly string[]; readonly relationshipsUsed: readonly string[];
}
export interface CombinationFamily {
  readonly id: string; readonly pageFamily: string;
  /** Chaves de QueryPattern (`pattern_key`) dos tópicos que são as RAÍZES (pais) da expansão. */ readonly rootPatternKeys: readonly string[];
  /** Dimensões adicionáveis, em ordem: cada nível acrescenta uma, sempre depois da última acrescentada (sem permutações repetidas). */ readonly expandable: readonly string[];
  readonly longTail: boolean; readonly minItemsKey: string; readonly child: FamilyChild;
  /** O filho é um recorte do pai (padrão: sim): vale o teste |filho| ≤ razão × |pai|. Falso para famílias em que o filho NÃO é subconjunto (ex.: comparação); o bloco exclusivo continua exigido. */
  readonly parentRedundancy?: boolean;
}
export type Filter = "F1_semantic" | "F2_entity_geo" | "F3_depth" | "F4_data_sufficiency" | "F5_parent_redundancy" | "F6_demand" | "F7_cannibalization" | "cap";
export type Outcome = "kept" | "pruned" | "duplicate" | "capped";
export interface LogEntry { readonly topicId: string; readonly parentTopicId: string | null; readonly family: string; readonly level: number; readonly dimensions: Dims; readonly outcome: Outcome; readonly filter: Filter | null; readonly reason: string; readonly details: Readonly<Record<string, unknown>> }
export interface Kept { readonly topicId: string; readonly parentTopicId: string; readonly dimensions: Dims; readonly level: number; readonly count: number; readonly demand: DemandInfo | null; readonly demandStatus: "OBSERVED" | "HYPOTHESIS"; readonly exclusiveBlocks: number }
export interface ExpansionResult { readonly kept: readonly Kept[]; readonly log: readonly LogEntry[]; readonly capped: boolean; readonly evaluated: number }
