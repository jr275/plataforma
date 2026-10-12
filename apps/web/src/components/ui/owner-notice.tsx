"use client";

import { useAppState } from "@/components/app-state";
import type { WorkspaceData } from "@/data/demo/types";
import { Button } from "./button";

/** Aviso quando um registro aberto por URL pertence a outro workspace demonstrativo que o selecionado. */
export function OwnerNotice({ owner }: { owner: WorkspaceData }) {
  const { current, selectWorkspace, notify } = useAppState();
  if (owner.workspace.id === current.workspace.id) return null;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p>Este registro pertence ao workspace demonstrativo <strong>{owner.workspace.name}</strong>, não ao selecionado.</p>
      <Button size="sm" variant="outline" onClick={() => { selectWorkspace(owner.workspace.id); notify(`Workspace de demonstração: ${owner.workspace.name}.`); }}>
        Trocar para {owner.workspace.name}
      </Button>
    </div>
  );
}
