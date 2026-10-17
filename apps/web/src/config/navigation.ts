import {
  Activity,
  BadgeCheck,
  BookOpenText,
  Bot,
  Braces,
  Building2,
  CalendarRange,
  ChartNoAxesCombined,
  Database,
  Factory,
  FileSearch,
  FlaskConical,
  GitBranch,
  Globe,
  GraduationCap,
  Layers,
  LayoutDashboard,
  LayoutTemplate,
  Link2,
  Network,
  Plug,
  Search,
  Quote,
  Radar,
  ScanSearch,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

export type NavStatus = "ready" | "partial" | "planned" | "blocked";

export type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
  /** Estado da área. "planned"/"blocked" mostram um marcador discreto na navegação. */
  status?: NavStatus;
  /** Rotas secundárias que acendem este item (ex.: /pages → Page Generation). */
  match?: readonly string[];
};

export type NavGroup = { id: string; label?: string; items: readonly NavItem[] };

export const navigation: readonly NavGroup[] = [
  {
    id: "intelligence",
    label: "Intelligence",
    items: [
      { id: "overview", label: "Overview", icon: LayoutDashboard, href: "/" },
      { id: "opportunities", label: "Opportunity Discovery", icon: Target, href: "/opportunities" },
      { id: "trends", label: "Trends & News", icon: TrendingUp, href: "/trends", status: "partial", match: ["/research"] },
      { id: "roadmap", label: "Opportunity Roadmap", icon: CalendarRange, href: "/roadmap" },
    ],
  },
  {
    id: "search",
    label: "Search Intelligence",
    items: [
      { id: "serp", label: "SERP Explorer", icon: ScanSearch, href: "/serp", status: "partial" },
      { id: "competitors", label: "Competitors", icon: Building2, href: "/competitors", status: "planned" },
      { id: "search-gaps", label: "Search Gaps", icon: FileSearch, href: "/search-gaps" },
      { id: "search-universe", label: "Keyword Clusters", icon: Globe, href: "/search-universe" },
    ],
  },
  {
    id: "knowledge",
    label: "Knowledge",
    items: [
      { id: "graph", label: "Knowledge Graph", icon: Waypoints, href: "/graph" },
      { id: "entities", label: "Entities", icon: Network, href: "/entities" },
      { id: "knowledge", label: "Evidence & Sources", icon: BookOpenText, href: "/knowledge" },
      { id: "data-sources", label: "Data Sources", icon: Database, href: "/data-sources", match: ["/data-flow"] },
    ],
  },
  {
    id: "factory",
    label: "Experience Factory",
    items: [
      { id: "blueprints", label: "Page Blueprints", icon: Layers, href: "/blueprints" },
      { id: "templates", label: "Templates", icon: LayoutTemplate, href: "/templates", match: ["/programmatic"] },
      { id: "generation", label: "Page Generation", icon: Factory, href: "/generation", match: ["/pages"] },
      { id: "linking", label: "Internal Linking", icon: Link2, href: "/linking", status: "partial" },
      { id: "structured-data", label: "Structured Data", icon: Braces, href: "/structured-data", status: "partial" },
    ],
  },
  {
    id: "quality",
    label: "Quality & GEO",
    items: [
      { id: "quality", label: "Quality Gates", icon: ShieldCheck, href: "/quality-trust" },
      { id: "geo", label: "AI Search Visibility", icon: Radar, href: "/geo", status: "planned" },
      { id: "citations", label: "Citations", icon: Quote, href: "/citations", status: "planned" },
      { id: "indexing", label: "Indexing & Technical SEO", icon: BadgeCheck, href: "/indexing", status: "blocked" },
    ],
  },
  {
    id: "performance",
    label: "Performance",
    items: [
      { id: "analytics", label: "Traffic & Rankings", icon: Activity, href: "/analytics", status: "partial" },
      { id: "search-console", label: "Search Console", icon: Search, href: "/analytics/search-console" },
      { id: "conversions", label: "Conversions", icon: ChartNoAxesCombined, href: "/conversions", status: "planned" },
      { id: "experiments", label: "Experiments", icon: FlaskConical, href: "/experiments", status: "planned" },
      { id: "learning", label: "Outcome Learning", icon: GraduationCap, href: "/learning", status: "planned" },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      { id: "integrations", label: "Integrations", icon: Plug, href: "/integrations" },
      { id: "agents", label: "Workflows & Agents", icon: Bot, href: "/agents" },
      { id: "settings", label: "Tenant Settings", icon: Settings, href: "/settings" },
      { id: "audit", label: "Policies & Audit Log", icon: ScrollText, href: "/audit" },
    ],
  },
];

/** Rotas fora da navegação principal, mas acessíveis pela paleta de comandos. */
export const secondaryNavItems: readonly NavItem[] = [
  { id: "ask-ai", label: "Ask AI", icon: Sparkles, href: "/ask" },
  { id: "research", label: "Research", icon: FlaskConical, href: "/research" },
  { id: "pages", label: "Pages", icon: Layers, href: "/pages" },
  { id: "programmatic", label: "Programmatic", icon: GitBranch, href: "/programmatic" },
  { id: "data-flow", label: "Fluxo de dados", icon: Database, href: "/data-flow" },
];

export const allNavItems: readonly NavItem[] = [...navigation.flatMap((g) => g.items), ...secondaryNavItems];

const primaryItems = navigation.flatMap((g) => g.items);
const within = (pathname: string, href: string) => pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

/** Item ativo da navegação principal: o `href` (ou rota casada) mais específico que contém o caminho. */
export function activeNavId(pathname: string): string | undefined {
  const candidates = primaryItems.flatMap((i) => [i.href, ...(i.match ?? [])].map((href) => ({ id: i.id, href })));
  const exact = candidates.find((c) => c.href === pathname);
  if (exact) return exact.id;
  return candidates.filter((c) => within(pathname, c.href)).sort((a, b) => b.href.length - a.href.length)[0]?.id;
}

/** Rotas que leem dado REAL do banco (ADR-018). As demais ainda mostram dados de demonstração; o topo avisa qual é qual. */
export const REAL_DATA_ROUTES: readonly string[] = ["/data-flow", "/generation"];

export function isRealDataRoute(pathname: string): boolean {
  return REAL_DATA_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}
