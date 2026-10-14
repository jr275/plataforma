"use client";

import { Suspense, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu as MenuIcon, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { routeMode, type RouteMode } from "@/config/navigation";
import { UserMenu } from "./user-menu";
import { WorkspaceMenu } from "./workspace-menu";

/** Barra superior em azul sólido (âncora de marca): busca, workspace, tema e usuário. */
export function Topbar() {
  const { setNavOpen, setPaletteOpen, prefs, setPrefs } = useAppState();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  const iconButton = "p-1.5 text-primary-foreground/85 hover:bg-white/15 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none";
  const dark = prefs.theme === "dark";
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 bg-primary px-3 text-primary-foreground sm:px-5">
      <button type="button" onClick={() => setNavOpen(true)} aria-label="Abrir navegação" className={`${iconButton} lg:hidden`}>
        <MenuIcon className="size-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed })}
        aria-label={prefs.sidebarCollapsed ? "Expandir a barra lateral" : "Recolher a barra lateral"}
        aria-pressed={prefs.sidebarCollapsed}
        className={`${iconButton} hidden lg:block`}
      >
        {prefs.sidebarCollapsed ? <PanelLeftOpen className="size-5" aria-hidden="true" /> : <PanelLeftClose className="size-5" aria-hidden="true" />}
      </button>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 border border-white/30 bg-white/10 px-2.5 text-left font-mono text-[12px] text-primary-foreground/85 transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:max-w-md"
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Buscar ou executar um comando</span>
        <kbd className="hidden border border-white/35 px-1.5 text-[10px] sm:inline">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <Suspense fallback={<ModeBadge mode="demo" />}><ModeBadgeByRoute /></Suspense>
        <button type="button" onClick={() => setPrefs({ theme: dark ? "light" : "dark" })} aria-label={dark ? "Usar o tema claro" : "Usar o tema escuro"} aria-pressed={dark} className={iconButton}>
          {dark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
        </button>
        <Suspense fallback={<WorkspaceMenu onPrimary />}><WorkspaceSlot /></Suspense>
        <UserMenu onPrimary />
      </div>
    </header>
  );
}

const MODE_BADGE: Record<RouteMode, { label: string; dot: string }> = {
  real: { label: "Dado real", dot: "bg-emerald-300" },
  demo: { label: "Demonstração", dot: "bg-amber-300" },
  dev: { label: "Fixture de desenvolvimento", dot: "bg-sky-300" },
};

/** Indicador permanente do modo de dados da tela: real, demonstração (fictício, só no navegador) ou fixture de desenvolvimento. */
export function ModeBadge({ mode }: { mode: RouteMode }) {
  const m = MODE_BADGE[mode];
  return (
    <span role="status" data-testid="mode-badge" data-mode={mode} className="hidden items-center gap-1.5 border border-white/40 px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] uppercase md:inline-flex">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

/** Lê o caminho (só no cliente, dentro de Suspense: rotas com parâmetro dinâmico exigem isso) e diz em que modo a tela atual está. */
function ModeBadgeByRoute() {
  return <ModeBadge mode={routeMode(usePathname())} />;
}

/** O seletor de workspace é de demonstração: só aparece nas telas de demonstração. */
function WorkspaceSlot() {
  return routeMode(usePathname()) === "demo" ? <WorkspaceMenu onPrimary /> : null;
}
