import {
  Activity,
  BookOpenText,
  Boxes,
  Bot,
  Database,
  Factory,
  Workflow,
  FileStack,
  FlaskConical,
  Globe,
  LayoutDashboard,
  Lightbulb,
  Network,
  Settings,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
};

export type NavGroup = { id: string; label?: string; items: readonly NavItem[] };

export const navigation: readonly NavGroup[] = [
  {
    id: "workspace",
    items: [
      { id: "overview", label: "Overview", icon: LayoutDashboard, href: "/" },
      { id: "ask-ai", label: "Ask AI", icon: Sparkles, href: "/ask" },
    ],
  },
  {
    id: "discover",
    label: "Descobrir",
    items: [
      { id: "research", label: "Research", icon: FlaskConical, href: "/research" },
      { id: "search-universe", label: "Search Universe", icon: Globe, href: "/search-universe" },
      { id: "opportunities", label: "Opportunities", icon: Lightbulb, href: "/opportunities" },
    ],
  },
  {
    id: "know",
    label: "Conhecer",
    items: [
      { id: "knowledge", label: "Knowledge", icon: BookOpenText, href: "/knowledge" },
      { id: "entities", label: "Entities", icon: Network, href: "/entities" },
      { id: "data-sources", label: "Data Sources", icon: Database, href: "/data-sources" },
      { id: "data-flow", label: "Fluxo de dados", icon: Workflow, href: "/data-flow" },
    ],
  },
  {
    id: "act",
    label: "Executar",
    items: [
      { id: "pages", label: "Pages", icon: FileStack, href: "/pages" },
      { id: "programmatic", label: "Programmatic", icon: Boxes, href: "/programmatic" },
      { id: "generation", label: "Geração de páginas", icon: Factory, href: "/generation" },
      { id: "agents", label: "Agents", icon: Bot, href: "/agents" },
    ],
  },
  {
    id: "measure",
    label: "Medir",
    items: [
      { id: "quality", label: "Quality & Trust", icon: ShieldCheck, href: "/quality-trust" },
      { id: "analytics", label: "Analytics", icon: Activity, href: "/analytics" },
    ],
  },
  { id: "system", items: [{ id: "settings", label: "Settings", icon: Settings, href: "/settings" }] },
];

export const allNavItems: readonly NavItem[] = navigation.flatMap((g) => g.items);

/** Item ativo: o `href` mais específico que casa com o caminho. */
export function activeNavId(pathname: string): string | undefined {
  const linked = allNavItems.filter((i) => i.href);
  const exact = linked.find((i) => i.href === pathname);
  if (exact) return exact.id;
  return linked
    .filter((i) => i.href !== "/" && pathname.startsWith(`${i.href}/`))
    .sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0))[0]?.id;
}

/** Rotas que leem dado REAL do banco (ADR-018). As demais ainda mostram dados de demonstração; o topo avisa qual é qual. */
export const REAL_DATA_ROUTES: readonly string[] = ["/data-flow", "/generation"];

export function isRealDataRoute(pathname: string): boolean {
  return REAL_DATA_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}
