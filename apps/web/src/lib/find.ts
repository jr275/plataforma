import type { WorkspaceData } from "@/data/demo/types";

type Kind = "opportunities" | "entities" | "knowledge" | "pages" | "agents" | "sources" | "templates";

/** Procura um registro pelo id em todos os workspaces e devolve também o dono. Ids são únicos entre workspaces, exceto agentes. */
export function findAcross<K extends Kind>(workspaces: readonly WorkspaceData[], kind: K, id: string, preferred?: WorkspaceData) {
  const order = preferred ? [preferred, ...workspaces.filter((w) => w !== preferred)] : workspaces;
  for (const w of order) {
    const item = (w[kind] as readonly { id: string }[]).find((x) => x.id === id);
    if (item) return { owner: w, item: item as WorkspaceData[K][number] };
  }
  return undefined;
}
