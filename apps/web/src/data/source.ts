// Camada de acesso a dados da interface. HOJE devolve fixtures demonstrativas; quando houver funções tipadas em
// packages/api (regra 4 do CLAUDE.md), é aqui que elas entram. Nada de fixture fora de ./demo.
// O conteúdo de domínio vem SÓ dos workspaces listados aqui: nenhum componente deve supor um setor específico.
import { exemplo } from "./demo/exemplo";
import { northgate } from "./demo/northgate";
import type { WorkspaceData } from "./demo/types";

export const DATA_IS_DEMO = true;
export const DEFAULT_WORKSPACE_ID = exemplo.workspace.id;

export const DEMO_WORKSPACES: readonly WorkspaceData[] = [exemplo, northgate];

export async function listWorkspaceData(): Promise<readonly WorkspaceData[]> {
  return DEMO_WORKSPACES;
}
