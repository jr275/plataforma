import type { SpecBlueprint } from "../blueprint-spec/types";
import type { PageRecipe } from "../recipe/types";

// QA Q1–Q14 (spec 13.2). Q1–Q13 têm verificação do CÓDIGO; Q1, Q2, Q8, Q13 e Q14 também podem ser conferidas pelo Agente 8 (que SINALIZA; o código bloqueia). Q14 só existe com o verificador:
// sem ele fica NOT_RUN e nada é aprovado por padrão. Falha em Q1, Q2, Q8 ou Q13 é BLOQUEANTE, sem override automático.
export const QA_IDS = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14"] as const;
export type QaId = (typeof QA_IDS)[number];
export const BLOCKING: ReadonlySet<QaId> = new Set(["Q1", "Q2", "Q8", "Q13"]);
export const QA_TITLE: Readonly<Record<QaId, string>> = { Q1: "Fact checking", Q2: "Proveniência", Q3: "Completude", Q4: "Duplicação semântica", Q5: "Conteúdo fino", Q6: "Canibalização", Q7: "Coerência geográfica", Q8: "Distância vs tempo", Q9: "Links internos", Q10: "Dados estruturados", Q11: "Canonical e indexação", Q12: "Frescor", Q13: "Política editorial", Q14: "Utilidade" };
export type QaStatus = "PASS" | "FAIL" | "NOT_RUN";
export interface QaCheck { readonly status: QaStatus; readonly by: "code" | "llm" | "both" | "none"; readonly blocking: boolean; readonly issues: readonly string[]; readonly detail: string }
export type QaOutcome = "QA_PASSED" | "QA_FAILED" | "QA_INCOMPLETE";

/** Política de QA versionada por tenant (limiares e padrões, nunca constantes no código). */
export interface QaPolicy {
  /** Similaridade máxima de 5-gramas com páginas irmãs, depois de remover o nome do lugar e os valores (Q4). */ readonly maxSiblingSimilarity: number;
  /** Parcela mínima do conteúdo que varia por instância (Q5): nome do lugar e valores dos fatos. */ readonly minVariableShare: number;
  readonly minSiblingsForComparison: number; readonly shingleSize: number;
  /** Expressões regulares (flag i) de tempo de deslocamento (Q8). */ readonly travelTimePatterns: readonly string[];
  /** Expressões regulares (flag i) de política editorial proibida (Q13). */ readonly forbiddenClaims: readonly { readonly id: string; readonly pattern: string; readonly rule: string }[];
  /** Tipos schema.org com propriedades obrigatórias (Q10). */ readonly jsonLdRequired: Readonly<Record<string, readonly string[]>>;
}
export interface QaBundle {
  readonly recipe: PageRecipe; readonly blueprint: SpecBlueprint; readonly referenceTime: string;
  /** Texto das páginas irmãs da família (Q4/Q5/Q14). */ readonly siblings: readonly { readonly pageId: string; readonly text: string; readonly entityNames: readonly string[]; /** Valores dos fatos da irmã (removidos antes de comparar a forma do texto). */ readonly values?: readonly string[] }[];
  /** Páginas INDEXÁVEIS já existentes para o mesmo cluster de intenção (Q6). */ readonly competing: readonly { readonly url: string; readonly topicId: string }[];
  readonly knownPaths: ReadonlySet<string>; readonly policy: QaPolicy;
}
