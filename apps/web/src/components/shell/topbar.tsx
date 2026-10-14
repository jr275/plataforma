"use client";

import { Suspense, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu as MenuIcon, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { isRealDataRoute } from "@/config/navigation";
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

  const iconButton = "rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  const dark = prefs.theme === "dark";
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-background/90 px-3 text-foreground backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:px-5">
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
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-card px-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:max-w-md sm:flex-none sm:basis-md"
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Buscar ou executar um comando</span>
        <kbd className="hidden rounded-sm border border-border bg-muted px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <Suspense fallback={<ModeBadge real={false} />}><ModeBadgeByRoute /></Suspense>
        <button type="button" onClick={() => setPrefs({ theme: dark ? "light" : "dark" })} aria-label={dark ? "Usar o tema claro" : "Usar o tema escuro"} aria-pressed={dark} className={iconButton}>
          {dark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
        </button>
        <Suspense fallback={<WorkspaceMenu />}><WorkspaceSlot /></Suspense>
        <UserMenu />
      </div>
    </header>
  );
}

function ModeBadge({ real }: { real: boolean }) {
  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground md:inline-flex">
      <span aria-hidden="true" className={real ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-warning"} />
      {real ? "Dado real" : "Dados demonstrativos"}
    </span>
  );
}

/** Lê o caminho (só no cliente, dentro de Suspense: rotas com parâmetro dinâmico exigem isso) e diz se a tela atual usa dado real. */
function ModeBadgeByRoute() {
  return <ModeBadge real={isRealDataRoute(usePathname())} />;
}

/** O seletor de workspace é de demonstração: some nas telas com dado real. */
function WorkspaceSlot() {
  return isRealDataRoute(usePathname()) ? null : <WorkspaceMenu />;
}
