"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppState } from "@/components/app-state";
import { activeNavId, navigation } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";

/** Conteúdo único da navegação, usado na barra fixa (desktop, recolhível) e na gaveta (telas estreitas). */
export function SidebarContent({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  const pathname = usePathname();
  const active = activeNavId(pathname);
  return (
    <div className="flex h-full flex-col">
      <div className={cn("pt-3.5 pb-3", collapsed ? "px-2.5" : "px-3")}>
        <BrandMark compact={collapsed} />
      </div>
      <nav aria-label="Navegação principal" className={cn("min-h-0 flex-1 overflow-y-auto pb-4", collapsed ? "px-2" : "px-2")}>
        {navigation.map((group) => (
          <div key={group.id} className="mt-4 first:mt-0">
            {group.label && !collapsed ? <p className="px-2 pb-1.5 font-mono text-[10px] font-medium tracking-[0.1em] text-muted-foreground uppercase">{group.label}</p> : null}
            {group.label && collapsed ? <div className="mx-2 mb-1 h-px bg-sidebar-border" aria-hidden="true" /> : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === active;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      title={collapsed ? item.label : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "group flex h-8 items-center gap-2.5 px-2 text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        collapsed && "justify-center",
                        isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className={cn("size-4 shrink-0", isActive ? "text-sidebar-primary-foreground" : "text-muted-foreground group-hover:text-foreground")} aria-hidden="true" />
                      {collapsed ? null : <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
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
        prefs.sidebarCollapsed ? "w-14" : "w-64",
      )}
    >
      <SidebarContent collapsed={prefs.sidebarCollapsed} />
    </aside>
  );
}
