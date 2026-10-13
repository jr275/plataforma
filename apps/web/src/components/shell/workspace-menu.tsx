"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import { useAppState } from "@/components/app-state";

/** Seletor de workspace DEMONSTRATIVO: troca apenas os dados fictícios exibidos, nunca um tenant real. */
export function WorkspaceMenu({ onDone, onPrimary = false }: { onDone?: () => void; onPrimary?: boolean }) {
  const { workspaces, current, selectWorkspace, notify } = useAppState();
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Workspace atual: ${current.workspace.name}. Trocar workspace`}
        className={`flex h-8 max-w-56 items-center gap-2 border px-2 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${onPrimary ? "border-white/30 bg-white/10 text-primary-foreground hover:bg-white/20 data-[popup-open]:bg-white/20" : "border-border bg-card hover:bg-accent data-[popup-open]:bg-accent"}`}
      >
        <span className={`grid size-5 shrink-0 place-items-center text-[10px] font-semibold ${onPrimary ? "bg-white text-primary" : "bg-secondary"}`} aria-hidden="true">
          {current.workspace.name.slice(0, 1)}
        </span>
        <span className="hidden min-w-0 truncate text-[13px] font-medium sm:block">{current.workspace.name}</span>
        <ChevronsUpDown className={`size-3.5 shrink-0 ${onPrimary ? "text-primary-foreground/70" : "text-muted-foreground"}`} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start" className="z-[70]">
          <Menu.Popup className="min-w-64 rounded-lg border border-border bg-popover p-1 text-sm shadow-xl shadow-black/40 outline-none">
            <Menu.Group>
              <Menu.GroupLabel className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground">Workspaces de demonstração (dados fictícios)</Menu.GroupLabel>
              <Menu.RadioGroup
                value={current.workspace.id}
                onValueChange={(id: string) => {
                  const next = workspaces.find((w) => w.workspace.id === id);
                  if (!next || next.workspace.id === current.workspace.id) return;
                  selectWorkspace(id);
                  notify(`Workspace de demonstração: ${next.workspace.name}. Nenhum tenant real foi alterado.`);
                  onDone?.();
                }}
              >
                {workspaces.map((w) => (
                  <Menu.RadioItem key={w.workspace.id} value={w.workspace.id} closeOnClick className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{w.workspace.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{w.workspace.domain}</span>
                    </span>
                    <Menu.RadioItemIndicator>
                      <Check className="size-4 text-brand" aria-hidden="true" />
                    </Menu.RadioItemIndicator>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
