"use client";

import { useEffect } from "react";
import { Menu as MenuIcon, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { UserMenu } from "./user-menu";
import { WorkspaceMenu } from "./workspace-menu";

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

  const iconButton = "rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur sm:px-5">
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
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card/60 px-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:max-w-md sm:flex-none sm:basis-md"
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Buscar ou executar um comando</span>
        <kbd className="hidden rounded border border-border px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        <Badge tone="warning" className="hidden md:inline-flex">Dados demonstrativos</Badge>
        <WorkspaceMenu />
        <UserMenu />
      </div>
    </header>
  );
}
