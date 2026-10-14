import { createHash } from "node:crypto";

// Registro dos 8 agentes de runtime (fonte única do que cada um é): id estável, nome, estágio, versões de contrato, tempo-limite, tentativas, lote e dependências.
// A definição vive no código (versionada em git) e é espelhada por tenant em `agent_definition` (só INSERT, uma linha por mudança) para o Control Plane e a auditoria.
export type AgentStage = "topic" | "page";
export interface AgentDefinition {
  readonly agent: number;
  /** Id estável (nunca muda; o nome pode). */ readonly slug: string;
  readonly name: string;
  readonly stage: AgentStage;
  readonly purpose: string;
  readonly inputSchemaVersion: string;
  readonly outputSchemaVersion: string;
  /** Variável do prompt que recebe o JSON de entrada. */ readonly inputVar: string;
  /** Tempo-limite de UMA chamada ao modelo. */ readonly timeoutMs: number;
  /** Retentativas por falha TRANSITÓRIA (limite de taxa, rede, 5xx, tempo). Saída inválida tem as suas 2 correções dentro do runner. */ readonly maxRetries: number;
  /** Itens por chamada: 02–05 em lotes (20–50); 06–08 uma página por chamada; 01 uma chamada para o escopo. */ readonly batch: { readonly min: number; readonly max: number };
  readonly dependsOn: readonly number[];
  /** O que o CÓDIGO valida/decide depois do agente (o agente nunca decide). */ readonly codeAuthority: string;
}

const T = 60_000;
export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  { agent: 1, slug: "agent-01-inventory-summarizer", name: "Inventory Summarizer", stage: "topic", purpose: "Resume o inventário de atributos por entidade e família (descritivo)", inputSchemaVersion: "1", outputSchemaVersion: "1", inputVar: "ATTRIBUTE_CATALOG_JSON", timeoutMs: T, maxRetries: 2, batch: { min: 1, max: 1 }, dependsOn: [], codeAuthority: "números vêm do INPUT (topics_unblocked não pode mudar); ordenação e desempate determinísticos; nenhuma entidade inventada" },
  { agent: 2, slug: "agent-02-topic-proposer", name: "Topic Proposer", stage: "topic", purpose: "Propõe tópicos candidatos a partir de atributos e relações do grafo", inputSchemaVersion: "1", outputSchemaVersion: "1", inputVar: "ENTITY_CONTEXT_JSON", timeoutMs: T, maxRetries: 2, batch: { min: 1, max: 5 }, dependsOn: [1], codeAuthority: "cada proposta é validada contra o catálogo e a matriz de compatibilidade; ids inexistentes descartados; resultado vazio é legítimo" },
  { agent: 3, slug: "agent-03-intent-modeler", name: "Intent Modeler", stage: "topic", purpose: "Modela a intenção (o quê, onde, por quê, quando, para quem) separando observado de hipótese", inputSchemaVersion: "1", outputSchemaVersion: "1", inputVar: "TOPICS_AND_DEMAND_JSON", timeoutMs: T, maxRetries: 2, batch: { min: 20, max: 50 }, dependsOn: [2], codeAuthority: "demanda e unmet_need são recalculados do INPUT; divergência registrada, nunca aceita; palavra-chave fora da demanda observada é recusada" },
  { agent: 4, slug: "agent-04-combination-reviewer", name: "Combination Reviewer", stage: "topic", purpose: "Recomenda manter/fundir/podar combinações redundantes", inputSchemaVersion: "1", outputSchemaVersion: "1", inputVar: "COMBINATION_GROUPS_JSON", timeoutMs: T, maxRetries: 2, batch: { min: 20, max: 50 }, dependsOn: [3], codeAuthority: "só recomenda; o código decide e aplica, com histórico em decision_audit" },
  { agent: 5, slug: "agent-05-eligibility-explainer", name: "Eligibility Explainer", stage: "page", purpose: "Explica a decisão de elegibilidade já tomada pelo motor", inputSchemaVersion: "1", outputSchemaVersion: "1", inputVar: "ELIGIBILITY_DECISION_JSON", timeoutMs: T, maxRetries: 2, batch: { min: 20, max: 50 }, dependsOn: [], codeAuthority: "nunca altera a decisão; o código confere que a explicação não cita outra decisão nem sugere prontidão" },
  { agent: 6, slug: "agent-06-blueprint-writer", name: "Blueprint Writer", stage: "page", purpose: "Preenche os campos semânticos permitidos do blueprint", inputSchemaVersion: "1", outputSchemaVersion: "1", inputVar: "BLUEPRINT_DRAFT_JSON", timeoutMs: 90_000, maxRetries: 2, batch: { min: 1, max: 1 }, dependsOn: [5], codeAuthority: "só campos __FILL__ permitidos; placeholders e limites conferidos; INSUFFICIENT devolve o tópico ao enriquecimento" },
  { agent: 7, slug: "agent-07-editorial", name: "Editorial", stage: "page", purpose: "Redige os slots de narrativa referenciando fatos do recipe", inputSchemaVersion: "1", outputSchemaVersion: "1", inputVar: "COMPILED_RECIPE_JSON", timeoutMs: 120_000, maxRetries: 2, batch: { min: 1, max: 1 }, dependsOn: [6], codeAuthority: "slots e referências devem existir; números só dos fatos do slot; R3 (distância ≠ tempo); o texto determinístico permanece se reprovar" },
  { agent: 8, slug: "agent-08-qa-verifier", name: "QA Verifier", stage: "page", purpose: "Sinaliza problemas em Q1, Q2, Q8, Q13 e Q14", inputSchemaVersion: "1", outputSchemaVersion: "1", inputVar: "PAGE_QA_BUNDLE_JSON", timeoutMs: 90_000, maxRetries: 2, batch: { min: 1, max: 1 }, dependsOn: [7], codeAuthority: "só sinaliza (nunca aprova o que o código reprovou); o Quality Gate Engine decide" },
];
export const agentDefinition = (agent: number): AgentDefinition => { const d = AGENT_DEFINITIONS.find((x) => x.agent === agent); if (!d) throw new Error(`agente ${agent} não existe no registro`); return d; };

/** Hash estável da definição (muda quando qualquer parâmetro operacional muda → nova linha versionada em agent_definition). */
export const definitionHash = (d: AgentDefinition, model: string): string => createHash("sha256").update(JSON.stringify({ ...d, model })).digest("hex");

/** Variáveis permitidas em cada prompt (placeholders de contexto + a entrada do agente). Qualquer outra {{VAR}} reprova na validação de uma versão de prompt. */
export const CONTEXT_VARS = ["TENANT_NAME", "DOMAIN_PACK", "SCORE_BRAND", "EDITORIAL_STYLE", "RICH_MIN", "MAX_PROPOSALS", "SCOPE"] as const;
export const allowedPlaceholders = (agent: number): readonly string[] => [...CONTEXT_VARS, agentDefinition(agent).inputVar];
