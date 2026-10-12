// Camada de acesso a dados da interface. HOJE devolve fixtures demonstrativas; quando houver funções tipadas em
// packages/api (regra 4 do CLAUDE.md), é aqui que elas entram. Nada de fixture fora de ./demo.
import { aurora } from "./demo/aurora";
import { northgate } from "./demo/northgate";
import type { WorkspaceData } from "./demo/types";

export const DATA_IS_DEMO = true;
export const DEFAULT_WORKSPACE_ID = aurora.workspace.id;

const all: readonly WorkspaceData[] = [aurora, northgate];

export async function listWorkspaceData(): Promise<readonly WorkspaceData[]> {
  return all;
}
