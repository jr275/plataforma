// Tipos do modelo de demonstração. Seguem o modelo mental do produto (fonte → entidade → conhecimento → oportunidade → página
// → visibilidade → medição). Fatores ficam separados em níveis qualitativos: nunca uma nota única (ADR-002).
// TODOS os registros abaixo são DEMONSTRATIVOS: nada é medição, fato ou resultado real.

export type Level = "alta" | "média" | "baixa";
export type OpportunityStatus = "candidate" | "in_review" | "ready" | "blocked" | "dismissed";
export type SourceHealth = "ok" | "stale" | "error" | "pending";
export type GateStatus = "pass" | "fail" | "pending";
export type KnowledgeStatus = "verified" | "needs_review" | "expired";
export type PageStatus = "draft" | "in_review" | "blocked" | "ready";

export type Workspace = { id: string; name: string; domain: string };

export type Opportunity = {
  id: string;
  title: string;
  kind: "página" | "cluster" | "FAQ" | "comparativo";
  intent: "informacional" | "comparação" | "transacional";
  demand: Level;
  competition: Level;
  evidence: Level;
  status: OpportunityStatus;
  /** Ordem editorial (1 = mais urgente). Não é uma nota. */
  rank: number;
  summary: string;
  rationale: readonly string[];
  gaps: readonly string[];
  entityIds: readonly string[];
  sourceIds: readonly string[];
  knowledgeIds: readonly string[];
  nextAction: string;
  updated: string;
};

export type DataSource = {
  id: string;
  name: string;
  type: string;
  health: SourceHealth;
  freshness: string;
  records: number;
  description: string;
};
export type Entity = {
  id: string;
  label: string;
  type: string;
  summary: string;
  attributes: readonly { label: string; value: string }[];
  relatedIds: readonly string[];
};
export type KnowledgeRecord = {
  id: string;
  title: string;
  statement: string;
  sourceId: string;
  entityIds: readonly string[];
  confidence: Level;
  validUntil: string;
  status: KnowledgeStatus;
  updated: string;
};
export type PageItem = {
  id: string;
  path: string;
  title: string;
  kind: "guia" | "glossário" | "comparativo" | "FAQ" | "cluster";
  status: PageStatus;
  opportunityId?: string;
  entityIds: readonly string[];
  knowledgeIds: readonly string[];
  summary: string;
  gates: readonly { name: string; status: GateStatus }[];
};
export type SearchQuery = {
  id: string;
  text: string;
  intent: "informacional" | "comparação" | "transacional";
  demand: Level;
  cluster: string;
  trend: "subindo" | "estável" | "caindo";
  opportunityId?: string;
};
export type Agent = {
  id: string;
  name: string;
  role: string;
  description: string;
  scope: string;
  tools: readonly string[];
  lastRun: string;
  /** Resultado simulado de uma execução (determinístico). */
  simulatedOutput: string;
};
export type Template = { id: string; name: string; pattern: string; entityType: string; description: string; fields: readonly string[] };
export type Finding = {
  id: string;
  section: "Mercado" | "Concorrência" | "Lacunas";
  title: string;
  summary: string;
  evidence: readonly string[];
  opportunityId?: string;
  entityIds: readonly string[];
};
export type ActivityItem = { id: string; actor: string; kind: "agent" | "human" | "system"; text: string; when: string };
export type KnowledgeGap = { id: string; text: string; opportunityId?: string };
export type Gate = { id: string; name: string; status: GateStatus; detail: string };

export type WorkspaceData = {
  workspace: Workspace;
  opportunities: readonly Opportunity[];
  sources: readonly DataSource[];
  entities: readonly Entity[];
  knowledge: readonly KnowledgeRecord[];
  pages: readonly PageItem[];
  queries: readonly SearchQuery[];
  agents: readonly Agent[];
  templates: readonly Template[];
  findings: readonly Finding[];
  activity: readonly ActivityItem[];
  gaps: readonly KnowledgeGap[];
  gates: readonly Gate[];
};
