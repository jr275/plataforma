import { Activity, BookOpenText, Boxes, Bot, Database, Factory, FileStack, FlaskConical, Globe, LayoutDashboard, Lightbulb, MapPinned, Network, Plug, Quote, Route, Settings, ShieldCheck, Sparkles, Swords, LineChart, TrendingUp, Waypoints, Workflow, Beaker, type LucideIcon } from "lucide-react";

/** Real routes resolve the tenant on the server. Reference routes describe capabilities, never observations. */
export type NavMode = "real" | "demo" | "planned" | "reference";
export type NavItem = { id: string; label: string; icon: LucideIcon; mode: NavMode; href?: string; hint?: string };
export type NavGroup = { id: string; label?: string; items: readonly NavItem[] };
export const navigation: readonly NavGroup[] = [
  { id: "intelligence", label: "Inteligência", items: [
    { id: "command-center", label: "Visão geral", icon: LayoutDashboard, href: "/", mode: "real" },
    { id: "opportunities", label: "Descoberta", icon: Lightbulb, href: "/opportunities", mode: "real" },
    { id: "trends", label: "Tendências e notícias", icon: TrendingUp, href: "/trends", mode: "real" },
    { id: "roadmap", label: "Roadmap", icon: Route, href: "/roadmap", mode: "real" },
    { id: "engine", label: "Motor de páginas", icon: Workflow, href: "/engine", mode: "real" },
  ] },
  { id: "search", label: "Inteligência de busca", items: [
    { id: "serp-competition", label: "SERP Explorer", icon: Globe, href: "/serp", mode: "reference" },
    { id: "competitors", label: "Concorrentes", icon: Swords, mode: "planned", hint: "Depende de resultados de SERP armazenados, com URL, consulta, localização e data de coleta. Nenhum concorrente foi observado por esta interface." },
    { id: "research", label: "Lacunas de busca", icon: FlaskConical, href: "/research", mode: "demo" },
    { id: "search-intelligence", label: "Clusters de consultas", icon: Boxes, href: "/search-universe", mode: "demo" },
  ] },
  { id: "knowledge", label: "Conhecimento", items: [
    { id: "knowledge-graph", label: "Grafo de conhecimento", icon: Waypoints, href: "/graph", mode: "real" },
    { id: "entities", label: "Entidades", icon: Network, href: "/entities", mode: "demo" },
    { id: "knowledge-base", label: "Evidências e fontes", icon: BookOpenText, href: "/knowledge", mode: "demo" },
    { id: "data-sources", label: "Fontes de dados", icon: Database, href: "/data-sources", mode: "demo" },
    { id: "cities", label: "Cidades", icon: MapPinned, href: "/cities", mode: "real" },
  ] },
  { id: "build", label: "Fábrica de experiências", items: [
    { id: "blueprints", label: "Blueprints", icon: FileStack, href: "/blueprints", mode: "real" },
    { id: "templates", label: "Templates", icon: Boxes, href: "/templates", mode: "reference" },
    { id: "generation-studio", label: "Geração de páginas", icon: Factory, href: "/generation", mode: "real" },
    { id: "internal-linking", label: "Links internos", icon: Network, mode: "planned", hint: "Os links propostos já podem ser inspecionados no blueprint de cada oportunidade. A gestão global depende de um inventário de páginas e de validação dos destinos." },
    { id: "structured-data", label: "Dados estruturados", icon: Boxes, mode: "planned", hint: "O blueprint declara os tipos propostos e a prévia permite revisar a experiência. O relatório global depende da validação do JSON-LD de páginas geradas." },
    { id: "content", label: "Páginas demonstrativas", icon: FileStack, href: "/pages", mode: "demo" },
    { id: "programmatic-seo", label: "SEO programático", icon: Boxes, href: "/programmatic", mode: "demo" },
  ] },
  { id: "quality", label: "Qualidade e GEO", items: [
    { id: "quality-trust", label: "Gates de qualidade", icon: ShieldCheck, href: "/quality-trust", mode: "demo" },
    { id: "geo", label: "Visibilidade em IA", icon: Sparkles, href: "/geo", mode: "reference" },
    { id: "citations", label: "Citações", icon: Quote, mode: "planned", hint: "Depende de respostas observadas por provedor, consulta, horário e URL citada. Veja a cobertura dos provedores em Visibilidade em IA. Citação potencial no score não é citação observada." },
    { id: "indexing", label: "Indexação e SEO técnico", icon: Globe, mode: "planned", hint: "Depende de publicação e de uma propriedade verificada no Search Console. A saúde do índice precisa ser medida; uma prévia não é uma página indexada." },
  ] },
  { id: "performance", label: "Performance", items: [
    { id: "analytics", label: "Tráfego e rankings", icon: LineChart, href: "/analytics", mode: "demo" },
    { id: "conversions", label: "Conversões", icon: Activity, mode: "planned", hint: "Depende de eventos de conversão e atribuição por página, oportunidade e período. Nenhuma receita ou conversão será inferida de um score." },
    { id: "experiments", label: "Experimentos", icon: Beaker, mode: "planned", hint: "Depende de páginas publicadas, hipótese, grupo de comparação e medições de resultado. Ainda não existe executor de experimentos." },
    { id: "performance-learning", label: "Aprendizado", icon: TrendingUp, mode: "planned", hint: "Depende de resultados medidos, histórico de mudanças e regras de atribuição. Os pesos do score podem ser configurados; não há otimização automática por resultado." },
  ] },
  { id: "system", label: "Sistema", items: [
    { id: "integrations", label: "Integrações", icon: Plug, href: "/integrations", mode: "real" },
    { id: "data-flow", label: "Fluxo de dados", icon: Workflow, href: "/data-flow", mode: "real" },
    { id: "agents", label: "Agentes", icon: Bot, href: "/agents", mode: "demo" },
    { id: "workflows", label: "Workflows", icon: Workflow, mode: "planned", hint: "Os fluxos de pesquisa e geração existentes registram suas execuções. O orquestrador geral de workflows ainda não foi implementado." },
    { id: "ask-ai", label: "Assistente", icon: Sparkles, href: "/ask", mode: "demo" },
    { id: "settings", label: "Configurações", icon: Settings, href: "/settings", mode: "demo" },
    { id: "policies", label: "Políticas e auditoria", icon: ShieldCheck, mode: "planned", hint: "As transições e versões já têm histórico por oportunidade. Um registro global consultável de políticas e auditoria depende de API própria e controle de acesso." },
  ] },
];

export const allNavItems: readonly NavItem[] = navigation.flatMap((g) => g.items);
/** Itens com rota. Planejados abrem o inspetor de dependências da navegação. */
export const linkedNavItems: readonly (NavItem & { href: string })[] = allNavItems.filter((i): i is NavItem & { href: string } => i.href !== undefined);

/** Item ativo: o `href` mais específico que casa com o caminho. */
export function activeNavId(pathname: string): string | undefined {
  const exact = linkedNavItems.find((i) => i.href === pathname);
  if (exact) return exact.id;
  return linkedNavItems
    .filter((i) => i.href !== "/" && pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.id;
}

/** Rotas que leem dado REAL do banco (ADR-018). Derivadas da navegação: um único lugar decide o que é real. */
export const REAL_DATA_ROUTES: readonly string[] = linkedNavItems.filter((i) => i.mode === "real").map((i) => i.href);

export function isRealDataRoute(pathname: string): boolean {
  return REAL_DATA_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/** Modo de dados da tela atual: `real` (banco do tenant), `dev` (fixture de desenvolvimento, só fora de produção) ou `demo` (dados fictícios no navegador). */
export type RouteMode = "real" | "dev" | "demo" | "reference";
export function routeMode(pathname: string): RouteMode {
  if (pathname === "/dev" || pathname.startsWith("/dev/")) return "dev";
  if (linkedNavItems.some((i) => i.mode === "reference" && (pathname === i.href || pathname.startsWith(`${i.href}/`)))) return "reference";
  return isRealDataRoute(pathname) ? "real" : "demo";
}
