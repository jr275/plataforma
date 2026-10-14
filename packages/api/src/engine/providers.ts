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
export type CapabilityState = "implemented_tested" | "implemented_unverified" | "configured_unverified" | "awaiting_credential" | "awaiting_decision" | "not_implemented";
export const CAPABILITY_STATE_LABEL: Record<CapabilityState, string> = {
  implemented_tested: "Implementada e testada", implemented_unverified: "Implementada, sem resposta real verificada", configured_unverified: "Configurada, não verificada", awaiting_credential: "Aguardando credencial", awaiting_decision: "Aguardando decisão de produto", not_implemented: "Ainda não implementada",
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
  { id: "ibge-sidra", label: "IBGE SIDRA (população e densidade por município)", state: "implemented_tested", detail: "Tabela 4714 do Censo 2022; fixture real (São Paulo) e consulta ao vivo com resposta 200. Dado estrutural para fatos e blueprint, não demanda de busca. Renda e domicílios ainda não têm tabela verificada.", unlocks: [], contract: null },
  { id: "gdelt", label: "GDELT (notícias complementares)", state: "implemented_unverified", detail: "Adapter, limite de 1 requisição a cada 5 s e parser prontos. Só foram capturadas respostas reais de limite (429) e de consulta vazia; o formato de sucesso vem da documentação. Falta uma execução com resposta real de artigos.", unlocks: [], contract: null },
  { id: "overpass", label: "OpenStreetMap (Overpass): escolas, estações, parques e mercados", state: "implemented_unverified", detail: "Adapter e parser prontos (lista fechada de categorias, cache de 30 dias, nunca em renderização). O servidor público respondeu 504 nas tentativas: nenhuma contagem real foi obtida. Também faltam coordenadas das entidades.", unlocks: [], contract: null },
  { id: "search-demand", label: "Demanda de busca (volume, CPC e dificuldade) e tendências", state: "awaiting_credential", detail: "Adapters DataForSEO (volume, dificuldade, relacionadas, sugestões e Trends) implementados e testados com fixtures construídas da documentação. A credencial no ambiente foi rejeitada pela API (HTTP 401): nenhuma resposta real foi obtida.", unlocks: ["demand"], contract: null },
  { id: "search-console", label: "Search Console da propriedade", state: "awaiting_credential", detail: "Adapter somente leitura (conta de serviço) e regra 'sem dados = desconhecido' implementados e testados com chave de teste e respostas construídas. Faltam GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY e GSC_SITE_URL no ambiente; a aprovação da lista de marca e do ADR-016 também continua pendente.", unlocks: ["demand", "authority_gap"], contract: null },
  { id: "serp-provider", label: "Provedor de SERP (Google: top 10, recursos, People Also Ask) e notícias", state: "awaiting_credential", detail: "Adapter DataForSEO (SERP orgânica e notícias) implementado, com gravação de snapshot, resultados e concorrentes, testado com fixtures construídas. Credencial rejeitada (HTTP 401). Até lá a etapa SERP só pode ser dispensada por exceção registrada (ADR-025).", unlocks: ["serp_opportunity", "competition", "authority_gap", "information_gain"], contract: "SerpProvider" },
  { id: "backlinks", label: "Backlinks e força de domínio", state: "awaiting_credential", detail: "Adapter DataForSEO (resumo de backlinks) implementado e testado com fixture construída. Credencial rejeitada (HTTP 401).", unlocks: ["authority_gap"], contract: null },
  { id: "competitor-registry", label: "Concorrentes e grafo competitivo", state: "awaiting_credential", detail: "Tabelas e gravação relacionais implementadas (concorrentes, snapshots e resultados da SERP, testados com isolamento por tenant). Os concorrentes só passam a existir quando uma SERP real for coletada ou o dono declarar a lista.", unlocks: ["competition", "authority_gap"], contract: null },
  { id: "llm-classifier", label: "Classificação por LLM (intenção, estágio, JTBD e tipo de página)", state: "awaiting_credential", detail: "Classificador com esquema estrito (zod), versão de prompt e modelo registrados e rejeição de saída inválida, testado com respostas no formato documentado. Falta ANTHROPIC_API_KEY no ambiente. Só classifica; nunca produz número nem fato.", unlocks: [], contract: null },
  { id: "ai-citations", label: "Monitoramento de citações em mecanismos de IA", state: "not_implemented", detail: "Somente o contrato (AiMentionQuery, AiMentionObservation) existe, como base do Citation Potential na próxima unidade. Nenhuma chamada é feita e nenhum resultado é exibido.", unlocks: ["citation_potential"], contract: "AiCitationMonitor" },
  { id: "conversion-data", label: "Dados de conversão e funil (GA4, CRM)", state: "awaiting_credential", detail: "Propriedade GA4 e/ou CRM com acesso autorizado.", unlocks: ["pipeline_potential"], contract: null },
  { id: "publication", label: "Publicação de páginas", state: "awaiting_decision", detail: "Decisão do dono sobre o site e o mecanismo de publicação, mais a saúde do índice do domínio de pelo menos 95% (regra 9).", unlocks: [], contract: null },
];

/** As que ainda NÃO existem (qualquer estado diferente de implementada e testada). */
export const PENDING_CAPABILITIES: readonly CapabilityDef[] = CAPABILITIES.filter((c) => c.state !== "implemented_tested");
/** Compatibilidade: nome anterior do registro das pendentes. */
export const BLOCKED_CAPABILITIES = PENDING_CAPABILITIES;
