import { STAGES, TOOLS, type OperationalEvidence as Evidence, type ExecutionMode, type OperationalStatus, type ToolState } from "@plataforma/api";
import type { FlowDefinition, FlowEdgeSpec, FlowNodeSpec, FlowStatus, InspectorItem, InspectorRow, NodeKind, RowTone } from "@/lib/flow/model";

// Constrói o fluxo operacional a partir do REGISTRO e dos ESTADOS já avaliados (módulo puro). Nada é desenhado à mão: as arestas vêm das
// dependências reais entre ferramentas de etapas diferentes, e etapa sem implementação é declarada como tal, sem ligação inventada.

export const OP_LABEL: Readonly<Record<OperationalStatus, string>> = {
  WORKING: "Funcionando", DEGRADED: "Degradado", NOT_WORKING: "Com falha", NOT_CONFIGURED: "Não configurado", NOT_TESTED: "Não testado",
  BLOCKED: "Bloqueado", MOCK: "Simulado", DISABLED: "Desabilitado", STALE: "Verificação vencida",
};

export const MODE_LABEL: Readonly<Record<ExecutionMode, string>> = { live: "real", sandbox: "sandbox", replay: "REPLAY", simulated: "SIMULADO", mock: "MOCK", import: "IMPORTADO" };

const FLOW_STATUS: Readonly<Record<OperationalStatus, FlowStatus>> = {
  WORKING: "completed", DEGRADED: "needs_review", STALE: "needs_review", NOT_WORKING: "failed", BLOCKED: "blocked",
  NOT_CONFIGURED: "idle", NOT_TESTED: "idle", MOCK: "skipped", DISABLED: "skipped",
};

const TONE: Readonly<Record<OperationalStatus, RowTone>> = {
  WORKING: "good", DEGRADED: "warn", STALE: "warn", NOT_WORKING: "bad", BLOCKED: "bad", NOT_CONFIGURED: "muted", NOT_TESTED: "muted", MOCK: "warn", DISABLED: "muted",
};

/** Prioridade para resumir uma etapa: o pior estado das suas ferramentas habilitadas aparece primeiro. */
const SEVERITY: readonly OperationalStatus[] = ["NOT_WORKING", "BLOCKED", "NOT_CONFIGURED", "DEGRADED", "STALE", "MOCK", "NOT_TESTED", "WORKING", "DISABLED"];

const KIND: Readonly<Record<string, NodeKind>> = {
  ingestion: "source", normalization: "entity", entity_resolution: "entity", relationship_graph: "entity", poi_geo: "intel", search_intent: "intel",
  evidence_rationale: "knowledge", page_opportunity: "intel", generation: "generate", quality_gates: "gate", seo_geo_validation: "gate", approval: "judge",
  publishing: "publish", measurement: "observe", learning: "learn",
};

const LINKS: Readonly<Record<string, { label: string; href: string }>> = {
  "platform.identity": { label: "Integrações", href: "/integrations" }, "platform.database": { label: "Fluxo de dados", href: "/data-flow" },
  "ingest.city-import": { label: "Fluxo de dados", href: "/data-flow" }, "search.gsc-live": { label: "Integrações", href: "/integrations" },
  "search.dataforseo": { label: "Integrações", href: "/integrations" }, "generate.city-pages": { label: "Geração de páginas", href: "/generation" },
  "generate.og-preview": { label: "Geração de páginas", href: "/generation" }, "quality.gates": { label: "Geração de páginas", href: "/generation" },
  "measure.gsc-export": { label: "Relatório do Search Console", href: "/analytics/search-console" },
};

const fmtAt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)} UTC`;
export const describeEvidence = (e: Evidence | null): string => (e ? `${e.kind} · ${MODE_LABEL[e.mode]} · ${fmtAt(e.at)} · id ${e.id}` : "nenhuma evidência registrada");

export interface StageSummary { readonly id: string; readonly op: OperationalStatus | "NOT_IMPLEMENTED"; readonly reason: string; readonly toolIds: readonly string[]; /** WORKING só por arquivo importado: a etapa não conta como verificada. */ readonly importOnly?: boolean }

export function summarizeStage(stageId: string, states: ReadonlyMap<string, ToolState>): StageSummary {
  const stage = STAGES.find((s) => s.id === stageId)!;
  const tools = TOOLS.filter((t) => t.stage === stageId);
  if (tools.length === 0) {
    return stage.implementation === "absent"
      ? { id: stageId, op: "NOT_IMPLEMENTED", reason: stage.note, toolIds: [] }
      : { id: stageId, op: "NOT_TESTED", reason: `implementação parcial sem ferramenta registrada nem registro de execução. ${stage.note}`, toolIds: [] };
  }
  const enabled = tools.filter((t) => t.enabled);
  const list = (enabled.length > 0 ? enabled : tools).map((t) => states.get(t.id)!);
  const worst = SEVERITY.find((s) => list.some((x) => x.status === s)) ?? "NOT_TESTED";
  const culprit = list.find((x) => x.status === worst)!;
  const importOnly = worst === "WORKING" && list.some((x) => x.mode === "import");
  const reason = worst !== "WORKING" ? `${culprit.id}: ${culprit.reason}` : importOnly ? "funciona a partir de arquivo importado: não é execução real nem sincronização, então a etapa não conta como verificada" : "todas as ferramentas habilitadas da etapa estão funcionando";
  return { id: stageId, op: worst, reason, toolIds: tools.map((t) => t.id), importOnly };
}

/** Arestas reais: cada dependência entre ferramentas de etapas diferentes vira uma ligação (sem duplicar). */
export function stageEdges(): { source: string; target: string }[] {
  const stageOf = new Map(TOOLS.map((t) => [t.id, t.stage]));
  const seen = new Set<string>();
  const out: { source: string; target: string }[] = [];
  for (const t of TOOLS) for (const d of t.dependsOn) {
    const a = stageOf.get(d), b = t.stage;
    if (!a || a === b || a === "infra" || b === "infra") continue;
    const k = `${a}>${b}`;
    if (!seen.has(k)) { seen.add(k); out.push({ source: a, target: b }); }
  }
  return out;
}

const COL = 380, ROW = 300;
const POS: Readonly<Record<string, [number, number]>> = {
  ingestion: [0, 0], normalization: [1, 0], entity_resolution: [2, 0], relationship_graph: [3, 0], poi_geo: [4, 0],
  search_intent: [0, 1], evidence_rationale: [1, 1], page_opportunity: [2, 1], generation: [3, 1], quality_gates: [4, 1],
  seo_geo_validation: [0, 2], approval: [1, 2], publishing: [2, 2], measurement: [3, 2], learning: [4, 2],
};

export function buildOperationsFlow(states: ReadonlyMap<string, ToolState>, options: { running: boolean }): FlowDefinition {
  const summaries = new Map(STAGES.map((s) => [s.id, summarizeStage(s.id, states)]));
  const edges = stageEdges();
  const nodes: FlowNodeSpec[] = STAGES.map((stage) => {
    const sm = summaries.get(stage.id)!;
    const absent = sm.op === "NOT_IMPLEMENTED";
    const tools = TOOLS.filter((t) => t.stage === stage.id);
    const rows: InspectorRow[] = [
      { label: "Implementação", value: stage.implementation === "implemented" ? "implementada" : stage.implementation === "partial" ? "parcial" : "ausente", tone: stage.implementation === "implemented" ? "good" : stage.implementation === "partial" ? "warn" : "bad" },
      { label: "Status operacional", value: absent ? "NOT_IMPLEMENTED" : `${sm.op} · ${OP_LABEL[sm.op as OperationalStatus]}`, tone: absent ? "bad" : TONE[sm.op as OperationalStatus] },
      { label: "Ferramentas registradas", value: String(tools.length) },
    ];
    const items: InspectorItem[] = tools.map((t) => {
      const st = states.get(t.id)!;
      const deps = t.dependsOn.length > 0 ? ` Depende de: ${t.dependsOn.map((d) => `${d} (${states.get(d)!.status})`).join(", ")}.` : "";
      return { title: `${t.name} — ${st.status}`, text: `${st.reason}. Evidência: ${describeEvidence(st.evidence)}.${deps}`, tone: TONE[st.status] };
    });
    const link = tools.map((t) => LINKS[t.id]).find(Boolean);
    return {
      id: stage.id, kind: KIND[stage.id] ?? "scope", title: stage.label, description: stage.note,
      status: absent ? "unavailable" : FLOW_STATUS[sm.op as OperationalStatus],
      statusLabel: absent ? "Não implementada" : sm.importOnly ? "Funcionando (importado)" : OP_LABEL[sm.op as OperationalStatus],
      summary: absent ? "Etapa ausente nesta linha de código" : sm.reason,
      x: POS[stage.id]![0] * COL, y: POS[stage.id]![1] * ROW,
      detail: {
        purpose: stage.note, rows, items: items.length > 0 ? items : undefined,
        blocker: absent ? stage.note : ["NOT_WORKING", "BLOCKED", "NOT_CONFIGURED"].includes(sm.op) ? sm.reason : undefined,
        downstream: edges.filter((e) => e.source === stage.id).map((e) => STAGES.find((s) => s.id === e.target)!.label),
        links: link ? [link] : undefined,
      },
    };
  });
  const flowEdges: FlowEdgeSpec[] = edges.map((e) => {
    const [ax, ay] = POS[e.source]!, [bx, by] = POS[e.target]!;
    const sameRow = ay === by && bx > ax;
    return { id: `e:${e.source}>${e.target}`, source: e.source, target: e.target, sourceHandle: sameRow ? "r" : "b", targetHandle: sameRow ? "l" : "t", active: false };
  });
  return { id: "operations", title: "Fluxo operacional", nodes, edges: flowEdges, mode: options.running ? "live" : "recorded" };
}

export interface ToolRow {
  readonly id: string; readonly name: string; readonly stage: string; readonly provider: string; readonly criticality: string;
  readonly status: OperationalStatus; readonly reason: string; readonly mode: string; readonly evidence: string;
  readonly blockedBy: readonly string[]; readonly rootCause: string | null; readonly impacts: readonly string[];
}

/** Uma linha por ferramenta, com o que ela bloqueia (dependentes diretas) e a causa raiz. */
export function buildToolRows(states: ReadonlyMap<string, ToolState>): ToolRow[] {
  return TOOLS.map((t) => {
    const s = states.get(t.id)!;
    return {
      id: t.id, name: t.name, stage: t.stage, provider: t.provider ?? "interno", criticality: t.criticality, status: s.status, reason: s.reason,
      mode: s.mode ? MODE_LABEL[s.mode] : "—", evidence: describeEvidence(s.evidence), blockedBy: s.blockedBy, rootCause: s.rootCause,
      impacts: TOOLS.filter((x) => x.dependsOn.includes(t.id)).map((x) => x.id),
    };
  });
}
