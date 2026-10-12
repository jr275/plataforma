// DADOS FICTÍCIOS, só para o protótipo visual. Nada aqui é medição, fato ou resultado do produto: nenhuma tela lê o banco
// (regra 4 do CLAUDE.md) e nenhum número daqui entra em texto publicado (regra 1). Os nomes são inventados e genéricos
// (nada de RE/MAX, imóvel ou corretor fora de packs/real-estate: regra 10). Substituir por funções de packages/api.

export const demoTenants = [
  { id: "demo-1", name: "Loja Exemplo", active: true },
  { id: "demo-2", name: "Estúdio Modelo", active: false },
  { id: "demo-3", name: "Clínica Fictícia", active: false },
] as const;

/** Saúde do índice = URLs 2xx canônicas / URLs rastreadas; a regra 9 exige pelo menos 95% antes da primeira onda. */
export const demoIndexHealth = { canonical2xx: 1824, crawled: 2001, minimum: 0.95 } as const;

export type GateStatus = "pass" | "fail" | "pending";

/** Cada gate grava o próprio resultado; não existe nota composta (regra 5, ADR-002). */
export const demoGates: ReadonlyArray<{ id: string; name: string; status: GateStatus; detail: string }> = [
  { id: "facts", name: "Fatos com fonte", status: "pass", detail: "Todo número em texto aponta para um fato com fonte e validade." },
  { id: "canonical", name: "Canonical e duplicidade", status: "fail", detail: "3 páginas sem canonical definido." },
  { id: "noindex", name: "Ambiente de teste com noindex", status: "pass", detail: "Este ambiente não é indexável." },
  { id: "structured", name: "Dados estruturados", status: "pending", detail: "Aguardando a compilação das páginas." },
  { id: "links", name: "Links internos", status: "pending", detail: "Aguardando a compilação das páginas." },
  { id: "a11y", name: "Acessibilidade básica", status: "pass", detail: "Sem violações nos modelos revisados." },
];

export type Level = "alta" | "média" | "baixa";

/** Fatores separados, em níveis qualitativos: nunca uma nota única (ADR-002). */
export const demoOpportunities: ReadonlyArray<{
  page: string;
  intent: string;
  demand: Level;
  competition: Level;
  evidence: Level;
  state: string;
}> = [
  { page: "/guias/organizar-estoque", intent: "informacional", demand: "alta", competition: "média", evidence: "alta", state: "em revisão" },
  { page: "/comparativos/planilha-ou-sistema", intent: "comparação", demand: "média", competition: "alta", evidence: "média", state: "rascunho" },
  { page: "/glossario/giro-de-estoque", intent: "informacional", demand: "baixa", competition: "baixa", evidence: "alta", state: "pronta para gate" },
  { page: "/guias/inventario-anual", intent: "informacional", demand: "média", competition: "média", evidence: "baixa", state: "bloqueada por gate" },
];

export const demoQueue = [
  { state: "Rascunho", count: 14 },
  { state: "Em revisão", count: 6 },
  { state: "Bloqueada por gate", count: 3 },
  { state: "Publicada", count: 0 },
] as const;
