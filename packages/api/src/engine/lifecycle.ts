// Ciclo de vida da oportunidade (ADR-023, seção 7). UMA tabela de transições: o gatilho SQL da migration 0008 é gerado a partir dela e um teste de
// produto confere que os dois coincidem para todos os pares de estados.
export const STATES = [
  "discovered", "validated", "scored", "eligible", "serp_analyzed", "blueprinted", "data_assembled", "evidence_validated", "experience_built", "qa",
  "published", "indexed", "monitored", "converted", "measured", "learned", "refreshed", "retired", "rejected",
] as const;
export type LifecycleState = (typeof STATES)[number];
export const isState = (x: unknown): x is LifecycleState => typeof x === "string" && (STATES as readonly string[]).includes(x);

export const STATE_LABEL: Record<LifecycleState, string> = {
  discovered: "Descoberta", validated: "Validada", scored: "Pontuada", eligible: "Elegível", serp_analyzed: "SERP analisada", blueprinted: "Com blueprint",
  data_assembled: "Dados montados", evidence_validated: "Evidências validadas", experience_built: "Experiência construída", qa: "Em QA", published: "Publicada",
  indexed: "Indexada", monitored: "Monitorada", converted: "Convertida", measured: "Medida", learned: "Aprendizado registrado", refreshed: "Para atualizar", retired: "Aposentada", rejected: "Rejeitada",
};

export const TRANSITIONS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  discovered: ["validated", "rejected", "retired"],
  validated: ["scored", "rejected", "retired"],
  scored: ["eligible", "retired"],
  // `eligible -> blueprinted` é a DISPENSA registrada da etapa SERP (ADR-024): só enquanto não há provedor de SERP; o blueprint grava a SERP como não avaliada.
  eligible: ["serp_analyzed", "blueprinted", "scored", "retired"],
  serp_analyzed: ["blueprinted", "scored", "retired"],
  blueprinted: ["data_assembled", "serp_analyzed", "retired"],
  data_assembled: ["evidence_validated", "blueprinted", "retired"],
  evidence_validated: ["experience_built", "data_assembled", "retired"],
  experience_built: ["qa", "evidence_validated", "retired"],
  qa: ["published", "experience_built", "retired"],
  published: ["indexed", "retired"],
  indexed: ["monitored", "retired"],
  monitored: ["converted", "measured", "retired"],
  converted: ["measured", "retired"],
  measured: ["learned", "retired"],
  learned: ["refreshed", "retired"],
  refreshed: ["scored", "retired"],
  retired: [],
  rejected: ["discovered", "retired"],
};

export class LifecycleError extends Error {
  readonly code = "INVALID_TRANSITION";
  constructor(readonly from: LifecycleState, readonly to: LifecycleState) {
    super(`transição inválida: ${from} → ${to}`);
    this.name = "LifecycleError";
  }
}
export const canTransition = (from: LifecycleState, to: LifecycleState): boolean => TRANSITIONS[from].includes(to);
/** Destinos que uma PESSOA pode registrar à mão: não afirmam trabalho feito (aposentar, voltar a pontuada, reabrir uma rejeitada). As demais etapas (SERP, blueprint, dados,
 *  publicação, indexação...) só são registradas pelo fluxo que realiza o trabalho; marcar à mão diria algo que não aconteceu. */
export const MANUAL_TARGETS: readonly LifecycleState[] = ["retired", "scored", "discovered"];
export const canTransitionManually = (from: LifecycleState, to: LifecycleState): boolean => canTransition(from, to) && MANUAL_TARGETS.includes(to);
export const manualNext = (from: LifecycleState): readonly LifecycleState[] => TRANSITIONS[from].filter((t) => MANUAL_TARGETS.includes(t));
export const allowedNext = (from: LifecycleState): readonly LifecycleState[] => TRANSITIONS[from];
export const isTerminal = (s: LifecycleState): boolean => TRANSITIONS[s].length === 0;
export function assertTransition(from: LifecycleState, to: LifecycleState): void { if (!canTransition(from, to)) throw new LifecycleError(from, to); }

/** Estados em que a oportunidade ainda pode receber uma nova pontuação sem mudar de estado. */
export const RESCORABLE: readonly LifecycleState[] = ["scored", "eligible", "serp_analyzed", "blueprinted"];

/** Etapas cujo trabalho o sistema REALMENTE executa hoje. As demais existem no ciclo de vida (contrato), mas nenhum fluxo as realiza: aparecem como "sem fluxo". */
export const IMPLEMENTED_STATES: readonly LifecycleState[] = ["discovered", "validated", "scored", "eligible", "blueprinted", "data_assembled", "evidence_validated", "experience_built", "qa", "rejected", "retired"];

/** Etapas depois de QA: existem no modelo e na tabela de transições, mas NENHUMA transição para elas é executável nesta fase (a regra também está no gatilho SQL da migration 0012). */
export const PUBLICATION_STATES: readonly LifecycleState[] = ["published", "indexed", "monitored", "converted", "measured", "learned", "refreshed"];
export const isPublicationState = (s: LifecycleState): boolean => PUBLICATION_STATES.includes(s);
export class PublicationBlockedError extends Error {
  readonly code = "PUBLICATION_BLOCKED";
  constructor(readonly from: LifecycleState, readonly to: LifecycleState) { super(`transição bloqueada: ${STATE_LABEL[to]} (publicação e etapas seguintes) não está habilitada nesta fase`); this.name = "PublicationBlockedError"; }
}
/** Lança para qualquer destino de publicação, mesmo que a tabela de transições o permita. Toda função que muda o estado passa por aqui. */
export function assertExecutable(from: LifecycleState, to: LifecycleState): void { assertTransition(from, to); if (isPublicationState(to)) throw new PublicationBlockedError(from, to); }
