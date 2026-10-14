// Contratos dos nós do editor de experiência de página (ADR-026). Cada tipo declara: o que é, se pode ser criado/removido, quantos pode haver e QUAIS campos são
// configuráveis. O editor só permite configurar campos do contrato; o que não está aqui não existe. Puro: roda no navegador e no servidor.
export const NODE_TYPES = ["opportunity", "search_intent", "entity", "data_source", "evidence_requirement", "page_template", "page_section", "internal_link", "seo_metadata", "structured_data", "quality_gate", "publication"] as const;
export type NodeType = (typeof NODE_TYPES)[number];
export const GATE_IDS = ["business", "knowledge", "experience", "search", "geo", "technical"] as const;
export type GateId = (typeof GATE_IDS)[number];

export type FieldKind = "text" | "number" | "bool" | "enum" | "list";
export interface FieldSpec {
  readonly key: string; readonly label: string; readonly kind: FieldKind; readonly required: boolean; readonly hint: string;
  readonly max?: number; readonly min?: number; readonly pattern?: string;
  /** Campo fixo: aparece, mas a edição é recusada. */
  readonly locked?: boolean;
  /** Onde estão as opções de `enum`/`list`: chave do contexto (ver DraftContext) ou valores fixos. */
  readonly options?: "templates" | "sections" | "requirements" | "sources" | "requirementTokens" | "structuredData" | readonly string[];
}
export interface NodeContract {
  readonly type: NodeType; readonly label: string; readonly describe: string;
  readonly addable: boolean; readonly removable: boolean; readonly singleton: boolean;
  readonly fields: readonly FieldSpec[];
  /** Campos exibidos, mas NÃO editáveis (derivados do que está gravado). */
  readonly derived: readonly string[];
}

export const CONTRACTS: Readonly<Record<NodeType, NodeContract>> = {
  opportunity: { type: "opportunity", label: "Oportunidade", describe: "A hipótese que originou a página. Derivada do motor de oportunidades; não editável aqui.", addable: false, removable: false, singleton: true, fields: [], derived: ["query", "status", "pattern"] },
  search_intent: { type: "search_intent", label: "Intenção de busca", describe: "Intenção e estágio definidos pela vertical. Derivados; não editáveis.", addable: false, removable: false, singleton: true, fields: [], derived: ["intent", "stage", "experience"] },
  entity: { type: "entity", label: "Entidade / conhecimento", describe: "A entidade real do tenant (ex.: cidade) e os fatos conhecidos dela. Derivada; não editável aqui.", addable: false, removable: false, singleton: true, fields: [], derived: ["name", "kind", "facts"] },
  data_source: { type: "data_source", label: "Fonte de dados", describe: "Origem de dados REAL já implementada. Só fontes implementadas podem ser adicionadas.", addable: true, removable: true, singleton: false, fields: [{ key: "source", label: "Fonte", kind: "enum", required: true, options: "sources", hint: "Somente fontes implementadas e testadas." }], derived: ["state", "fields"] },
  evidence_requirement: { type: "evidence_requirement", label: "Requisito de evidência", describe: "O que a vertical exige comprovar e quais fontes aceita.", addable: true, removable: true, singleton: false, fields: [
    { key: "requirementId", label: "Requisito", kind: "enum", required: true, options: "requirements", hint: "Definido pela vertical." },
    { key: "acceptedSources", label: "Fontes aceitas", kind: "list", required: true, options: "requirementTokens", hint: "Fontes que satisfazem o requisito (da lista da vertical)." },
    { key: "criterion", label: "Critério", kind: "enum", required: true, options: ["any", "all"], hint: "any: basta uma fonte; all: todas." },
  ], derived: ["satisfied", "weight"] },
  page_template: { type: "page_template", label: "Template de página", describe: "O template do registro que gera a página. Só templates implementados.", addable: true, removable: false, singleton: true, fields: [{ key: "templateKey", label: "Template", kind: "enum", required: true, options: "templates", hint: "Somente templates existentes no registro." }], derived: ["version", "entityKind", "slots"] },
  page_section: { type: "page_section", label: "Seção da página", describe: "Uma seção do template, com ordem e condição de renderização.", addable: true, removable: true, singleton: false, fields: [
    { key: "sectionId", label: "Seção do template", kind: "enum", required: true, options: "sections", hint: "Seções que o template realmente tem." },
    { key: "heading", label: "Título (opcional)", kind: "text", required: false, max: 80, pattern: "^[^0-9]*$", hint: "Sem algarismos: números só entram por fato com fonte." },
    { key: "order", label: "Ordem", kind: "number", required: true, min: 1, max: 99, hint: "Posição na página (única)." },
    { key: "enabled", label: "Renderizar", kind: "bool", required: true, hint: "Desligada, a seção não aparece." },
    { key: "onMissing", label: "Se faltarem fatos", kind: "enum", required: true, options: ["omit", "block"], hint: "omit: omite a seção; block: bloqueia a validação." },
  ], derived: ["requires", "data"] },
  internal_link: { type: "internal_link", label: "Link interno", describe: "Link para uma página do próprio site. Só vira link se o destino existir.", addable: true, removable: true, singleton: false, fields: [
    { key: "path", label: "Caminho", kind: "text", required: true, max: 120, pattern: "^/[a-z0-9][a-z0-9/-]*$", hint: "Caminho interno em minúsculas (ex.: /cidades/sp)." },
    { key: "text", label: "Texto do link", kind: "text", required: true, max: 80, pattern: "^[^0-9]*$", hint: "Sem algarismos." },
  ], derived: ["resolves"] },
  seo_metadata: { type: "seo_metadata", label: "Metadados SEO", describe: "Título, descrição e canônico gerados pelo template com limites fixos. Regras exibidas; valores derivados.", addable: false, removable: false, singleton: true, fields: [], derived: ["title", "metaDescription", "canonical", "robots", "rules"] },
  structured_data: { type: "structured_data", label: "Dados estruturados", describe: "Tipo schema.org sustentado pelo template; propriedades só com fato e proveniência. Nada é emitido.", addable: true, removable: true, singleton: false, fields: [{ key: "type", label: "Tipo", kind: "enum", required: true, options: "structuredData", hint: "Tipos que o template sustenta." }], derived: ["required", "provenance"] },
  quality_gate: { type: "quality_gate", label: "Quality gate", describe: "Um dos seis gates independentes. Critérios fixos; resultado vem da avaliação, não da edição.", addable: false, removable: false, singleton: false, fields: [{ key: "gate", label: "Gate", kind: "enum", required: true, locked: true, options: GATE_IDS, hint: "Um nó por gate; fixo." }], derived: ["result", "blockers"] },
  publication: { type: "publication", label: "Decisão de publicação", describe: "Bloqueada: não há mecanismo de publicação. Nunca é autorizada por edição ou por gates sozinhos.", addable: false, removable: false, singleton: true, fields: [], derived: ["state", "prerequisites"] },
};

/** Conexões permitidas (de -> para): o modelo de domínio, não um editor genérico. */
export const ALLOWED_EDGES: readonly (readonly [NodeType, NodeType])[] = [
  ["opportunity", "search_intent"], ["opportunity", "entity"], ["search_intent", "page_template"],
  ["data_source", "entity"], ["data_source", "evidence_requirement"], ["entity", "evidence_requirement"],
  ["evidence_requirement", "page_section"], ["page_template", "page_section"], ["page_template", "seo_metadata"], ["page_template", "structured_data"], ["page_template", "internal_link"],
  ["page_section", "quality_gate"], ["internal_link", "quality_gate"], ["seo_metadata", "quality_gate"], ["structured_data", "quality_gate"], ["evidence_requirement", "quality_gate"],
  ["opportunity", "quality_gate"], ["page_template", "quality_gate"],
  ["quality_gate", "publication"],
];
export const canConnectTypes = (a: NodeType, b: NodeType): boolean => ALLOWED_EDGES.some(([x, y]) => x === a && y === b);
export const GATE_FIELD = "gate";
