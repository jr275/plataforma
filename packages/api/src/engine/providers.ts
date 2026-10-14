import type { DimensionId } from "./score-config";

// Contratos e ESTADO das capacidades do motor (ADR-023/024/025). Fontes que dependem de credencial, contrato ou decisão do dono NÃO têm implementação: o produto não simula
// SERP, concorrentes, citações nem Search Console. Os tipos fixam o formato esperado quando o provedor existir; o registro diz, para cada capacidade, em que estado ela está.
export interface SerpQuery { readonly text: string; readonly country: string; readonly language: string; readonly device: "desktop" | "mobile" }
export interface SerpResult { readonly rank: number; readonly url: string; readonly title: string; readonly domain: string; readonly type: "organic" | "featured_snippet" | "local_pack" | "video" | "news" | "other" }
export interface SerpObservation {
  readonly query: SerpQuery; /** Quando e por qual provedor foi observada: obrigatório (a SERP muda). */ readonly capturedAt: Date; readonly provider: string;
  readonly results: readonly SerpResult[]; readonly features: readonly string[]; readonly aiOverview: { readonly present: boolean; readonly citedDomains: readonly string[] } | null;
}
export interface SerpProvider { readonly id: string; readonly label: string; observe(query: SerpQuery): Promise<SerpObservation> }
export interface CitationObservation { readonly engine: string; readonly prompt: string; readonly capturedAt: Date; readonly answerExcerpt: string; readonly citedUrls: readonly string[]; readonly mentionsTenant: boolean }
export interface AiCitationMonitor { readonly id: string; readonly label: string; observe(prompt: string, engine: string): Promise<CitationObservation> }

/** Estado verificável de uma capacidade. `configured_unverified` só se aplica em tempo de execução (a sonda de integrações decide); o registro estático nunca o afirma. */
export type CapabilityState = "implemented_tested" | "configured_unverified" | "awaiting_credential" | "awaiting_decision" | "not_implemented";
export const CAPABILITY_STATE_LABEL: Record<CapabilityState, string> = {
  implemented_tested: "Implementada e testada", configured_unverified: "Configurada, não verificada", awaiting_credential: "Aguardando credencial", awaiting_decision: "Aguardando decisão de produto", not_implemented: "Ainda não implementada",
};
export interface CapabilityDef {
  readonly id: string; readonly label: string; readonly state: CapabilityState;
  /** O que falta, exatamente, para destravar (ou, se implementada, o que ela faz e como foi provada). */
  readonly detail: string;
  /** Dimensões do score que esta capacidade mede (implementada) ou passaria a medir (pendente). */
  readonly unlocks: readonly DimensionId[];
  /** Contrato (tipo) que a implementação deverá cumprir; `null` quando é só importação autorizada de dados. */
  readonly contract: "SerpProvider" | "AiCitationMonitor" | null;
}

export const CAPABILITIES: readonly CapabilityDef[] = [
  { id: "bcb-sgs", label: "Banco Central (SGS): juros e inflação", state: "implemented_tested", detail: "Séries Selic, IPCA e IGP-M; testes com respostas reais e consulta ao vivo registrada. Contexto macroeconômico, não demanda de busca.", unlocks: [], contract: null },
  { id: "ibge-news", label: "Notícias do IBGE (API pública)", state: "implemented_tested", detail: "Notícias filtradas pela vertical, com fonte e data; testes com respostas reais e consulta ao vivo registrada.", unlocks: [], contract: null },
  { id: "rss-news", label: "Agência Brasil (RSS público)", state: "implemented_tested", detail: "Respeita robots.txt e Crawl-delay; trecho curto com atribuição; testes e consulta ao vivo registrados.", unlocks: [], contract: null },
  { id: "search-demand", label: "Demanda de busca (Google Trends ou provedor de volume)", state: "awaiting_decision", detail: "Escolher e autorizar um provedor de tendências/volume (contrato e credencial do dono).", unlocks: ["demand"], contract: null },
  { id: "search-console", label: "Search Console da propriedade", state: "awaiting_credential", detail: "OAuth do dono com permissão completa, aprovação da lista de marca e do ADR-016, e migrations das tabelas de busca (exigem autorização).", unlocks: ["demand", "authority_gap"], contract: null },
  { id: "serp-provider", label: "Provedor de SERP e AI Overviews", state: "awaiting_decision", detail: "Contratar um provedor de SERP e registrar a credencial no servidor; implementar o contrato SerpProvider. Até lá a etapa SERP só pode ser dispensada por exceção registrada (ADR-025).", unlocks: ["serp_opportunity", "competition", "authority_gap", "information_gain"], contract: "SerpProvider" },
  { id: "competitor-registry", label: "Concorrentes e grafo competitivo", state: "not_implemented", detail: "Lista de concorrentes autorizada pelo dono ou derivada de uma SERP observada (depende do provedor de SERP).", unlocks: ["competition", "authority_gap"], contract: null },
  { id: "ai-citations", label: "Monitoramento de citações em mecanismos de IA", state: "awaiting_decision", detail: "Fonte de medição autorizada (mecanismos e prompts definidos pelo dono); implementar o contrato AiCitationMonitor.", unlocks: ["citation_potential"], contract: "AiCitationMonitor" },
  { id: "conversion-data", label: "Dados de conversão e funil (GA4, CRM)", state: "awaiting_credential", detail: "Propriedade GA4 e/ou CRM com acesso autorizado.", unlocks: ["pipeline_potential"], contract: null },
  { id: "publication", label: "Publicação de páginas", state: "awaiting_decision", detail: "Decisão do dono sobre o site e o mecanismo de publicação, mais a saúde do índice do domínio de pelo menos 95% (regra 9).", unlocks: [], contract: null },
];

/** As que ainda NÃO existem (qualquer estado diferente de implementada e testada). */
export const PENDING_CAPABILITIES: readonly CapabilityDef[] = CAPABILITIES.filter((c) => c.state !== "implemented_tested");
/** Compatibilidade: nome anterior do registro das pendentes. */
export const BLOCKED_CAPABILITIES = PENDING_CAPABILITIES;
