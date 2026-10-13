// Subconjunto dos eventos do protocolo AG-UI (https://docs.ag-ui.com) usados pela interface.
// Os nomes e campos seguem o protocolo para que um `HttpAgent` real (@ag-ui/client) ou o runtime do CopilotKit
// possa substituir o agente demonstrativo sem mudar o consumidor (`useAgentRun`).

export type AgUiEvent =
  | { type: "RUN_STARTED"; threadId: string; runId: string }
  | { type: "RUN_FINISHED"; threadId: string; runId: string }
  | { type: "RUN_ERROR"; message: string; code?: string }
  | { type: "STEP_STARTED"; stepName: string }
  | { type: "STEP_FINISHED"; stepName: string }
  | { type: "TEXT_MESSAGE_START"; messageId: string; role: "assistant" }
  | { type: "TEXT_MESSAGE_CONTENT"; messageId: string; delta: string }
  | { type: "TEXT_MESSAGE_END"; messageId: string }
  | { type: "TOOL_CALL_START"; toolCallId: string; toolCallName: string; parentMessageId?: string }
  | { type: "TOOL_CALL_ARGS"; toolCallId: string; delta: string }
  | { type: "TOOL_CALL_END"; toolCallId: string }
  | { type: "TOOL_CALL_RESULT"; toolCallId: string; messageId: string; content: string }
  | { type: "CUSTOM"; name: "graph.answer"; value: GraphAnswer }
  | { type: "CUSTOM"; name: "graph.highlight"; value: { nodeIds: string[]; edgeIds: string[] } }
  | { type: "CUSTOM"; name: "approval.request"; value: ChangeProposal };

export type ClaimKind = "fact" | "inference" | "suggestion";

export type Claim = {
  id: string;
  kind: ClaimKind;
  text: string;
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  /** Ids de nós `fact` que sustentam a afirmação. Vazio para inferências e sugestões sem evidência. */
  evidenceIds: readonly string[];
};

export type RelationRow = { edgeId: string; relation: string; direction: "out" | "in"; otherId: string; verification: string; evidenceCount: number };

export type GraphAnswer = { title: string; subjectId?: string; claims: readonly Claim[]; rows: readonly RelationRow[] };

export type ChangeProposal = {
  id: string;
  title: string;
  description: string;
  change: { kind: "verify_edge"; edgeId: string } | { kind: "flag_revalidation"; nodeId: string };
};
