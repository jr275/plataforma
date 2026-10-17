import type { ToolDefinition } from "./operational-status";

// Registro das etapas e das ferramentas que EXISTEM nesta linha de código (main + PRs abertos). Etapa sem ferramenta é declarada
// como ausente, nunca omitida: a cobertura de etapas mostra o buraco. As janelas de frescor são POLÍTICA padrão, ajustável.

export type Implementation = "implemented" | "partial" | "absent";
export interface StageDefinition { readonly id: string; readonly label: string; readonly implementation: Implementation; readonly note: string }

const DAY = 86_400_000;

export const STAGES: readonly StageDefinition[] = [
  { id: "ingestion", label: "Ingestão de dados", implementation: "implemented", note: "Importação de cidades (IBGE) com registro de execução; ainda sem sincronização recorrente." },
  { id: "normalization", label: "Normalização", implementation: "partial", note: "Ocorre dentro da importação (linhas aceitas, rejeitadas e duplicadas); sem etapa nem registro próprio." },
  { id: "entity_resolution", label: "Resolução de entidades", implementation: "partial", note: "Cidade como entidade com código IBGE; sem detecção de duplicidade nem fusão." },
  { id: "relationship_graph", label: "Grafo de relações", implementation: "absent", note: "Não existe nesta linha de código." },
  { id: "poi_geo", label: "Inteligência de POI e geografia", implementation: "absent", note: "Não existe nesta linha de código (existe só na branch do motor, não integrada)." },
  { id: "search_intent", label: "Intenção de busca", implementation: "partial", note: "Adaptadores de Search Console e DataForSEO existem; sem execução registrada." },
  { id: "evidence_rationale", label: "Evidência e justificativa", implementation: "partial", note: "Fatos rastreáveis na geração (gate de rastreabilidade); sem justificativa de oportunidade persistida." },
  { id: "page_opportunity", label: "Oportunidade de página", implementation: "partial", note: "A tela de oportunidades usa dados demonstrativos nesta linha (leitura real está no PR #11)." },
  { id: "generation", label: "Geração de conteúdo e páginas", implementation: "implemented", note: "Geração determinística por execução, com versões e imagem OG." },
  { id: "quality_gates", label: "Quality gates", implementation: "implemented", note: "Seis gates com resultado próprio por tentativa; sem nota composta." },
  { id: "seo_geo_validation", label: "Validação de SEO e GEO", implementation: "partial", note: "Gate de metadados; sem checagem de renderização, canônica ou indexação." },
  { id: "approval", label: "Aprovação", implementation: "absent", note: "Não existe fluxo de aprovação." },
  { id: "publishing", label: "Publicação", implementation: "absent", note: "Não existe publicação nesta linha de código." },
  { id: "measurement", label: "Medição", implementation: "partial", note: "Relatório a partir de export do Search Console (manual); sem conexão ao vivo." },
  { id: "learning", label: "Ciclo de aprendizado", implementation: "absent", note: "Não existe." },
];

export const STAGE_IDS: readonly string[] = STAGES.map((s) => s.id);

export const TOOLS: readonly ToolDefinition[] = [
  { id: "platform.identity", name: "Login e identidade (Supabase)", stage: "infra", provider: "Supabase", capability: "Sessão verificada com tenant na claim assinada", criticality: "critical", requiresConfig: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"], dependsOn: [], freshMs: 7 * DAY, enabled: true },
  { id: "platform.database", name: "Banco de dados da aplicação", stage: "infra", provider: "PostgreSQL (Neon)", capability: "Leitura por papel restrito com RLS", criticality: "critical", requiresConfig: ["PLATAFORMA_APP_DATABASE_URL"], dependsOn: [], freshMs: 1 * DAY, enabled: true },
  { id: "ingest.city-import", name: "Importação de cidades (IBGE)", stage: "ingestion", provider: "IBGE (arquivo oficial)", capability: "Importar cidades com origem, contagens e hash do arquivo", criticality: "critical", requiresConfig: [], dependsOn: ["platform.database"], freshMs: 30 * DAY, enabled: true },
  { id: "search.gsc-live", name: "Search Console ao vivo", stage: "search_intent", provider: "Google Search Console", capability: "Consulta autorizada de desempenho por conta de serviço", criticality: "important", requiresConfig: ["GSC_SITE_URL", "GSC_SERVICE_ACCOUNT_JSON_BASE64"], dependsOn: [], freshMs: 7 * DAY, enabled: true },
  { id: "search.dataforseo", name: "DataForSEO", stage: "search_intent", provider: "DataForSEO", capability: "Volume de busca e SERP (estimativas pagas, com teto de custo)", criticality: "supporting", requiresConfig: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"], dependsOn: [], freshMs: 7 * DAY, enabled: true },
  { id: "generate.city-pages", name: "Geração de páginas de cidade", stage: "generation", provider: null, capability: "Gerar rascunhos determinísticos a partir de fatos com fonte", criticality: "critical", requiresConfig: [], dependsOn: ["ingest.city-import", "platform.database", "platform.identity"], freshMs: 14 * DAY, enabled: true },
  { id: "generate.og-preview", name: "Imagem OG da página", stage: "generation", provider: null, capability: "Prévia privada por página (next/og)", criticality: "supporting", requiresConfig: [], dependsOn: ["generate.city-pages"], freshMs: 14 * DAY, enabled: true },
  { id: "quality.gates", name: "Quality gates (6)", stage: "quality_gates", provider: null, capability: "Resultado próprio por gate, sem nota composta", criticality: "critical", requiresConfig: [], dependsOn: ["generate.city-pages"], freshMs: 14 * DAY, enabled: true },
  { id: "measure.gsc-export", name: "Relatório do Search Console (export)", stage: "measurement", provider: "Google Search Console (export manual)", capability: "Relatório a partir de snapshot importado; não é conexão ao vivo", criticality: "supporting", requiresConfig: [], dependsOn: [], freshMs: 35 * DAY, enabled: true },
];
