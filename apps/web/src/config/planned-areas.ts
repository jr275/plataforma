import type { Crumb } from "@/components/ui/page-header";
import type { Dependency } from "@/components/intel/planned-workspace";

export type PlannedArea = {
  crumbs: readonly Crumb[];
  title: string;
  description: string;
  state: "planned" | "blocked";
  purpose: readonly string[];
  dependencies: readonly Dependency[];
  related?: readonly { label: string; href: string }[];
};

const area = (group: string, a: Omit<PlannedArea, "crumbs">): PlannedArea => ({ crumbs: [{ label: group }, { label: a.title }], ...a });

export const PLANNED_AREAS = {
  trends: area("Intelligence", {
    title: "Trends & News",
    description: "Sinais de mudança de demanda e notícias que afetam oportunidades existentes.",
    state: "planned",
    purpose: ["Detectar consultas com tendência de alta antes que a concorrência responda.", "Ligar notícias a entidades e oportunidades afetadas.", "Reabrir oportunidades descartadas quando o sinal muda."],
    dependencies: [{ name: "Provedor de tendências de busca", status: "missing", detail: "Nenhum provedor conectado; a tendência atual das consultas é editorial." }, { name: "Coleta de notícias", status: "missing", detail: "Sem fonte de notícias cadastrada." }],
    related: [{ label: "Research", href: "/research" }, { label: "Search Universe", href: "/search-universe" }],
  }),
  roadmap: area("Intelligence", {
    title: "Opportunity Roadmap",
    description: "Sequência de execução das oportunidades, por etapa do ciclo de vida e dependências.",
    state: "planned",
    purpose: ["Ordenar oportunidades por score, esforço e dependências de dados.", "Mostrar o que bloqueia cada item do roadmap.", "Planejar capacidade de produção por ciclo."],
    dependencies: [{ name: "Estimativa de esforço", status: "missing", detail: "Nenhuma oportunidade tem esforço registrado." }],
    related: [{ label: "Opportunity Discovery", href: "/opportunities" }],
  }),
  competitors: area("Search Intelligence", {
    title: "Competitors",
    description: "Domínios concorrentes por cluster, com cobertura e formatos observados.",
    state: "planned",
    purpose: ["Mapear quem ocupa cada cluster de consultas.", "Comparar formatos de página usados pelos concorrentes.", "Identificar temas em que nenhum concorrente atende bem a intenção."],
    dependencies: [{ name: "Provedor de SERP", status: "missing", detail: "Sem observação de resultados, não há domínios para comparar." }],
    related: [{ label: "SERP Explorer", href: "/serp" }],
  }),
  "search-gaps": area("Search Intelligence", {
    title: "Search Gaps",
    description: "Lacunas entre o que é buscado e o que o site consegue responder com evidência.",
    state: "planned",
    purpose: ["Cruzar consultas sem oportunidade com o conhecimento disponível.", "Priorizar lacunas por demanda e risco de evidência."],
    dependencies: [{ name: "Cobertura de consultas", status: "partial", detail: "O universo de buscas é uma amostra editorial; lacunas listadas abaixo vêm de observações registradas." }],
    related: [{ label: "Research", href: "/research" }, { label: "Knowledge", href: "/knowledge" }],
  }),
  templates: area("Experience Factory", {
    title: "Templates",
    description: "Templates de renderização usados pelos arquétipos de página.",
    state: "planned",
    purpose: ["Versionar templates e os campos que exigem.", "Ver quais páginas usam cada template.", "Editar o mapeamento entre arquétipo e template."],
    dependencies: [{ name: "Editor de templates", status: "missing", detail: "Os templates abaixo são somente leitura." }],
    related: [{ label: "Page Blueprints", href: "/blueprints" }, { label: "Programmatic", href: "/programmatic" }],
  }),
  linking: area("Experience Factory", {
    title: "Internal Linking",
    description: "Plano de links internos entre páginas, entidades e clusters.",
    state: "planned",
    purpose: ["Sugerir links a partir das relações do grafo de conhecimento.", "Detectar páginas órfãs e âncoras repetidas."],
    dependencies: [{ name: "Crawl do site publicado", status: "missing", detail: "Sem crawl, os links existentes não são conhecidos." }],
    related: [{ label: "Knowledge Graph", href: "/graph" }],
  }),
  "structured-data": area("Experience Factory", {
    title: "Structured Data",
    description: "Dados estruturados (JSON-LD) gerados por arquétipo e sua validação.",
    state: "planned",
    purpose: ["Gerar JSON-LD a partir de fatos verificados.", "Validar contra schema.org antes da publicação."],
    dependencies: [{ name: "Validador de schema", status: "missing", detail: "A checagem atual no Quality Gate só confirma o tipo esperado." }],
    related: [{ label: "Page Blueprints", href: "/blueprints" }],
  }),
  geo: area("Visibility", {
    title: "AI Search Visibility",
    description: "Presença das páginas e entidades em respostas de assistentes de IA.",
    state: "planned",
    purpose: ["Medir em quais respostas a marca aparece, por consulta.", "Comparar presença com concorrentes."],
    dependencies: [{ name: "Monitor de respostas de IA", status: "missing", detail: "Nenhuma resposta é coletada; não há medição de presença." }],
  }),
  citations: area("Visibility", {
    title: "Citations",
    description: "Citações das páginas em respostas de IA e em outros sites.",
    state: "planned",
    purpose: ["Registrar cada citação com a resposta e a data.", "Ligar citações aos fatos usados na página."],
    dependencies: [{ name: "Monitor de respostas de IA", status: "missing", detail: "Sem coleta, nenhuma citação é conhecida." }],
  }),
  indexing: area("Visibility", {
    title: "Indexing & Technical SEO",
    description: "Estado de indexação e problemas técnicos das páginas publicadas.",
    state: "blocked",
    purpose: ["Ver status de indexação por página.", "Listar erros de rastreamento e canonical."],
    dependencies: [{ name: "Search Console", status: "failing", detail: "A integração não está autorizada; nenhum dado de indexação foi recebido." }],
    related: [{ label: "Data Sources", href: "/data-sources" }],
  }),
  conversions: area("Performance", {
    title: "Conversions",
    description: "Conversões atribuídas às páginas geradas.",
    state: "planned",
    purpose: ["Atribuir conversões a páginas e chamadas para ação.", "Comparar arquétipos pela conversão."],
    dependencies: [{ name: "Analytics com eventos de conversão", status: "missing", detail: "Nenhum evento de conversão configurado." }],
  }),
  experiments: area("Performance", {
    title: "Experiments",
    description: "Testes de variações de blueprint, CTA e estrutura.",
    state: "planned",
    purpose: ["Rodar testes A/B entre módulos e CTAs.", "Registrar resultado e decisão."],
    dependencies: [{ name: "Feature flags / experimentação", status: "missing", detail: "Sem provedor de experimentos." }, { name: "Conversões", status: "missing", detail: "Sem métrica de sucesso disponível." }],
  }),
  learning: area("Performance", {
    title: "Outcome Learning",
    description: "Recalibração do score a partir de resultados observados.",
    state: "planned",
    purpose: ["Comparar o score previsto com o resultado real.", "Sugerir novos pesos com justificativa."],
    dependencies: [{ name: "Resultados de páginas publicadas", status: "missing", detail: "Nenhuma página tem resultado registrado; o score segue ilustrativo." }],
    related: [{ label: "Opportunity Discovery", href: "/opportunities" }],
  }),
  integrations: area("Workspace", {
    title: "Integrations",
    description: "Conexões com provedores de dados, busca, analytics e publicação.",
    state: "planned",
    purpose: ["Conectar e autorizar provedores.", "Ver saúde e última sincronização de cada um."],
    dependencies: [{ name: "Gestão de credenciais", status: "missing", detail: "Hoje as fontes são cadastradas em Data Sources." }],
    related: [{ label: "Data Sources", href: "/data-sources" }],
  }),
  audit: area("Workspace", {
    title: "Audit Log",
    description: "Histórico de ações humanas, de agentes e do sistema.",
    state: "planned",
    purpose: ["Registrar quem mudou o quê, quando e por quê.", "Exportar trilha de auditoria."],
    dependencies: [{ name: "Persistência de eventos", status: "missing", detail: "As ações desta demonstração não são gravadas." }],
  }),
} satisfies Record<string, PlannedArea>;

export type PlannedAreaId = keyof typeof PLANNED_AREAS;
