"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppState } from "@/components/app-state";
import { Modal } from "@/components/ui/modal";
import { TruthChip } from "@/components/ui/truth-chip";
import { activeNavId, navigation, type NavItem } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";

/** Conteúdo único da navegação, usado na barra fixa (desktop, recolhível) e na gaveta (telas estreitas). */
export function SidebarContent(props: { onNavigate?: () => void; collapsed?: boolean }) {
  // O caminho só existe no cliente para rotas com parâmetro dinâmico; dentro de Suspense a casca continua instantânea (sem item ativo até hidratar).
  return (
    <Suspense fallback={<SidebarView {...props} active={undefined} />}>
      <SidebarWithPath {...props} />
    </Suspense>
  );
}

function SidebarWithPath(props: { onNavigate?: () => void; collapsed?: boolean }) {
  return <SidebarView {...props} active={activeNavId(usePathname())} />;
}

const MODE_TAG = {
  real: { label: "dados do tenant", short: null },
  reference: { label: "capacidade sem medições", short: "info" },
  demo: { label: "demonstração (dados fictícios)", short: "demo" },
  planned: { label: "planejado: ainda não disponível", short: "em breve" },
} as const;

function SidebarView({ onNavigate, collapsed = false, active }: { onNavigate?: () => void; collapsed?: boolean; active: string | undefined }) {
  const [planned, setPlanned] = useState<NavItem | null>(null);
  return (
    <div className="flex h-full flex-col">
      <div className={cn("pt-3.5 pb-3", collapsed ? "px-2.5" : "px-3")}>
        <BrandMark compact={collapsed} />
      </div>
      <nav aria-label="Navegação principal" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {navigation.map((group) => (
          <div key={group.id} className="mt-4 first:mt-0">
            {group.label && !collapsed ? <p className="px-2 pb-1.5 font-mono text-[10px] font-medium tracking-[0.1em] text-muted-foreground uppercase">{group.label}</p> : null}
            {group.label && collapsed ? <div className="mx-2 mb-1 h-px bg-sidebar-border" aria-hidden="true" /> : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === active;
                const tag = MODE_TAG[item.mode];
                const base = "relative flex min-h-10 w-full rounded-md items-center gap-2.5 px-2 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring";
                const inner = (
                  <>
                    <Icon className={cn("size-4 shrink-0", isActive ? "text-brand" : "text-muted-foreground")} aria-hidden="true" />
                    {collapsed ? <span className="sr-only">{item.label} ({tag.label})</span> : (
                      <>
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.mode === "real" ? <span role="img" aria-label={tag.label} className="size-1.5 shrink-0 rounded-full bg-success" /> : <span aria-label={tag.label} className="shrink-0 font-mono text-[9px] tracking-[0.08em] text-muted-foreground/80 uppercase">{tag.short}</span>}
                      </>
                    )}
                  </>
                );
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        title={collapsed ? `${item.label} (${tag.label})` : undefined}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(base, collapsed && "justify-center", isActive ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground")}
                      >
                                                {inner}
                      </Link>
                    ) : (
                      <button type="button" aria-haspopup="dialog" onClick={() => setPlanned(item)} title={item.hint} className={cn(base, "text-left text-muted-foreground hover:bg-sidebar-accent", collapsed && "justify-center")}>
                        {inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <Modal open={planned !== null} onOpenChange={(open) => { if (!open) setPlanned(null); }} title={planned?.label ?? "Capacidade"} description="Disponibilidade desta capacidade">
        <TruthChip state="blocked">Planejado</TruthChip>
        <p className="mt-3 text-sm leading-relaxed">{planned?.hint}</p>
        <div className="mt-5 flex flex-wrap gap-4 text-sm"><Link className="underline underline-offset-4" href="/integrations" onClick={() => setPlanned(null)}>Ver integrações</Link><Link className="underline underline-offset-4" href="/opportunities" onClick={() => setPlanned(null)}>Abrir descoberta</Link></div>
      </Modal>
      {collapsed ? null : (
        <div className="border-t border-sidebar-border px-3 py-2.5 text-[10.5px] leading-snug text-muted-foreground">
          <p className="flex items-center gap-1.5"><span aria-hidden="true" className="size-1.5 rounded-full bg-success" />Rotas conectadas ao tenant</p>
          <p className="mt-1 flex items-center gap-1.5"><span aria-hidden="true" className="font-mono text-[9px] tracking-[0.08em] uppercase">demo</span>Protótipo com dados fictícios</p>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { prefs } = useAppState();
  return (
    <aside
      aria-label="Barra lateral"
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] lg:block",
        prefs.sidebarCollapsed ? "w-16" : "w-[250px]",
      )}
    >
      <SidebarContent collapsed={prefs.sidebarCollapsed} />
    </aside>
  );
}
