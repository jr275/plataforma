import {
  Activity,
  BookOpenText,
  Boxes,
  Bot,
  Database,
  Factory,
  FileStack,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Lightbulb,
  MapPinned,
  Network,
  Plug,
  Quote,
  Route,
  Settings,
  ShieldCheck,
  Sparkles,
  Swords,
  LineChart,
  TrendingUp,
  Waypoints,
  Workflow,
  Beaker,
  type LucideIcon,
} from "lucide-react";

/**
 * Estado de cada capacidade na navegação (fonte única; ver docs/product/PLATFORM_CAPABILITY_MATRIX.md):
 *  - `real`: lê dado real do banco do tenant da sessão (ADR-018) ou executa de verdade;
 *  - `demo`: tela de protótipo sobre dados de DEMONSTRAÇÃO guardados no navegador (nunca o tenant real);
 *  - `planned`: capacidade ainda sem rota; aparece desabilitada, nunca leva a uma tela vazia.
 */
export type NavMode = "real" | "demo" | "planned";

export type NavItem = { id: string; label: string; icon: LucideIcon; mode: NavMode; href?: string; hint?: string };
export type NavGroup = { id: string; label?: string; items: readonly NavItem[] };

export const navigation: readonly NavGroup[] = [
  {
    id: "command",
    items: [
      { id: "command-center", label: "Command Center", icon: LayoutDashboard, href: "/", mode: "demo" },
      { id: "ask-ai", label: "Ask AI", icon: Sparkles, href: "/ask", mode: "demo" },
    ],
  },
  {
    id: "intelligence",
    label: "Inteligência",
    items: [
      { id: "search-intelligence", label: "Search Intelligence", icon: Globe, href: "/search-universe", mode: "demo" },
      { id: "opportunities", label: "Oportunidades", icon: Lightbulb, href: "/opportunities", mode: "real" },
      { id: "roadmap", label: "Roadmap", icon: Route, href: "/roadmap", mode: "real" },
      { id: "trends", label: "Tendências e notícias", icon: TrendingUp, href: "/trends", mode: "real" },
      { id: "research", label: "Research", icon: FlaskConical, href: "/research", mode: "demo" },
    ],
  },
  {
    id: "knowledge",
    label: "Conhecimento",
    items: [
      { id: "knowledge-graph", label: "Knowledge Graph", icon: Waypoints, href: "/graph", mode: "real" },
      { id: "cities", label: "Cidades", icon: MapPinned, href: "/cities", mode: "real" },
      { id: "knowledge-base", label: "Knowledge Base", icon: BookOpenText, href: "/knowledge", mode: "demo" },
      { id: "entities", label: "Entities", icon: Network, href: "/entities", mode: "demo" },
    ],
  },
  {
    id: "data",
    label: "Dados",
    items: [
      { id: "data-sources", label: "Data Sources", icon: Database, href: "/data-sources", mode: "demo" },
      { id: "data-flow", label: "Fluxo de dados", icon: Workflow, href: "/data-flow", mode: "real" },
      { id: "integrations", label: "Integrations", icon: Plug, href: "/integrations", mode: "real" },
    ],
  },
  {
    id: "build",
    label: "Produção",
    items: [
      { id: "generation-studio", label: "Generation Studio", icon: Factory, href: "/generation", mode: "real" },
      { id: "content", label: "Content", icon: FileStack, href: "/pages", mode: "demo" },
      { id: "programmatic-seo", label: "Programmatic SEO", icon: Boxes, href: "/programmatic", mode: "demo" },
      { id: "agents", label: "Agents", icon: Bot, href: "/agents", mode: "demo" },
      { id: "workflows", label: "Workflows", icon: Workflow, mode: "planned", hint: "Orquestração de jobs: ainda não implementada." },
    ],
  },
  {
    id: "measure",
    label: "Qualidade e resultado",
    items: [
      { id: "quality-trust", label: "Quality & Trust", icon: ShieldCheck, href: "/quality-trust", mode: "demo" },
      { id: "analytics", label: "Analytics", icon: Activity, href: "/analytics", mode: "demo" },
      { id: "serp-competition", label: "SERP e concorrência", icon: Swords, mode: "planned", hint: "Depende de um provedor de SERP (ainda não contratado). Nenhuma posição ou concorrente é inventado." },
      { id: "geo", label: "GEO & AI Citations", icon: Quote, mode: "planned", hint: "Depende de uma fonte de medição autorizada (ainda não definida)." },
      { id: "performance-learning", label: "Desempenho e aprendizado", icon: LineChart, mode: "planned", hint: "Depende de publicação e do Search Console (bloqueados)." },
      { id: "experiments", label: "Experiments", icon: Beaker, mode: "planned", hint: "Depende de publicação e de dados de busca (bloqueados)." },
    ],
  },
  { id: "system", items: [{ id: "settings", label: "Settings", icon: Settings, href: "/settings", mode: "demo" }] },
];

export const allNavItems: readonly NavItem[] = navigation.flatMap((g) => g.items);
/** Itens que levam a uma rota (os planejados não têm rota). */
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
export type RouteMode = "real" | "dev" | "demo";
export function routeMode(pathname: string): RouteMode {
  if (pathname === "/dev" || pathname.startsWith("/dev/")) return "dev";
  return isRealDataRoute(pathname) ? "real" : "demo";
}
