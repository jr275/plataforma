// Contrato do fluxo vivo de geração. Módulo PURO (sem React, sem servidor): é montado no servidor a partir de registros reais e entregue ao
// cliente como dados serializáveis.
//
// Definição ≠ execução. A DEFINIÇÃO diz quais etapas existem e como se ligam (fixa, no código). A EXECUÇÃO é o estado de cada etapa, derivado
// dos registros reais (execução, itens, gates, versões). Nenhum status é inventado: etapa sem capacidade no backend é "unavailable" e diz
// isso; etapa que não participa desta geração é "skipped" e diz por quê.

export type FlowStatus = "idle" | "queued" | "running" | "completed" | "failed" | "blocked" | "needs_review" | "skipped" | "cancelled" | "unavailable";

export const STATUS_LABEL: Readonly<Record<FlowStatus, string>> = {
  idle: "Aguardando",
  queued: "Na fila",
  running: "Em execução",
  completed: "Concluída",
  failed: "Falhou",
  blocked: "Bloqueada",
  needs_review: "Revisão necessária",
  skipped: "Não usada",
  cancelled: "Cancelada",
  unavailable: "Não implementada",
};

/** Rótulo exibido do status de uma etapa: o próprio, quando a etapa traz um, senão o padrão. */
export const labelOf = (n: { readonly status: FlowStatus; readonly statusLabel?: string }): string => n.statusLabel ?? STATUS_LABEL[n.status];

/** Ordem de exibição dos filtros de status. */
export const STATUS_ORDER: readonly FlowStatus[] = ["running", "queued", "completed", "needs_review", "blocked", "failed", "idle", "skipped", "cancelled", "unavailable"];

export type NodeKind = "source" | "entity" | "knowledge" | "intel" | "recipe" | "generate" | "gate" | "judge" | "render" | "publish" | "observe" | "learn" | "scope";

export type RowTone = "default" | "good" | "warn" | "bad" | "muted";
export interface InspectorRow { readonly label: string; readonly value: string; readonly tone?: RowTone }
export interface InspectorItem { readonly title: string; readonly text: string; readonly tone?: RowTone }
export interface InspectorLink { readonly label: string; readonly href: string }

/** Conteúdo do painel de inspeção de uma etapa: só dados reais, já formatados. */
export interface InspectorContent {
  readonly purpose: string;
  readonly rows: readonly InspectorRow[];
  readonly items?: readonly InspectorItem[];
  /** Por que a etapa está bloqueada, reprovada ou indisponível. */
  readonly blocker?: string;
  readonly downstream: readonly string[];
  readonly links?: readonly InspectorLink[];
}

export interface FlowNodeSpec {
  /** Estável entre atualizações: vem da definição do workflow, nunca de um contador. */
  readonly id: string;
  readonly kind: NodeKind;
  readonly title: string;
  readonly description: string;
  readonly status: FlowStatus;
  /** Resultado mais relevante, em uma linha. */
  readonly summary?: string;
  /** Rótulo de status próprio (por exemplo, o status operacional). Sem ele vale o rótulo padrão do `status`. */
  readonly statusLabel?: string;
  /** Métricas pequenas, só quando existem de verdade (contagens, durações registradas). */
  readonly metrics?: readonly { readonly label: string; readonly value: string }[];
  /** 0 a 1, só quando há contagem real (itens registrados / total). */
  readonly progress?: number;
  readonly x: number;
  readonly y: number;
  readonly detail: InspectorContent;
}

export interface FlowEdgeSpec {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  /** A execução está passando por esta ligação agora (só com execução realmente em andamento). */
  readonly active?: boolean;
  /** Ligação de remediação (volta depois de uma reprovação). */
  readonly remediation?: boolean;
  readonly muted?: boolean;
  readonly label?: string;
  /** Alça de saída (padrão "r") e de entrada (padrão "l"): permitem ligações em ângulo reto por cima/por baixo dos cards. */
  readonly sourceHandle?: "r" | "b" | "tu" | "ls";
  readonly targetHandle?: "l" | "t" | "bt";
}

export interface FlowDefinition {
  readonly id: string;
  readonly title: string;
  readonly nodes: readonly FlowNodeSpec[];
  readonly edges: readonly FlowEdgeSpec[];
  /** Texto fixo que explica o que o fluxo representa (por exemplo, "execução ao vivo" ou "histórico"). */
  readonly mode: "live" | "recorded";
}

export function countByStatus(nodes: readonly FlowNodeSpec[]): Partial<Record<FlowStatus, number>> {
  const out: Partial<Record<FlowStatus, number>> = {};
  for (const n of nodes) out[n.status] = (out[n.status] ?? 0) + 1;
  return out;
}

/** Etapas visíveis para um filtro de status e uma busca; as demais ficam esmaecidas (o grafo não muda de forma). */
export function matchingNodeIds(nodes: readonly FlowNodeSpec[], statuses: ReadonlySet<FlowStatus>, query: string): ReadonlySet<string> {
  const q = query.trim().toLowerCase();
  const out = new Set<string>();
  for (const n of nodes) {
    if (statuses.size > 0 && !statuses.has(n.status)) continue;
    if (q && !`${n.title} ${n.description} ${n.summary ?? ""}`.toLowerCase().includes(q)) continue;
    out.add(n.id);
  }
  return out;
}

/** Duas definições com a mesma forma (mesmos ids de nós e de arestas): só o estado mudou, o grafo não precisa ser refeito. */
export function sameShape(a: FlowDefinition, b: FlowDefinition): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
  return a.nodes.every((n, i) => n.id === b.nodes[i]?.id) && a.edges.every((e, i) => e.id === b.edges[i]?.id);
}
