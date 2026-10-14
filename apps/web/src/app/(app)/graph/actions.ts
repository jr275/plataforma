"use server";

import { graph, withTenant } from "@plataforma/api";
import { actionContext, explainFailure } from "@/lib/server/action-context";

// Investigação do grafo: executa UMA ferramenta real e somente leitura sobre o nó escolhido. Identidade e tenant vêm da sessão (nunca do formulário);
// ferramenta e referência são validadas aqui, no servidor. Não há modelo de linguagem: cada ferramenta é uma consulta determinística.
export interface InvestigateState { runs: graph.GraphToolResult[]; error?: string }
const MAX_RUNS = 6;

export async function investigateAction(prev: InvestigateState, formData: FormData): Promise<InvestigateState> {
  const runs = prev?.runs ?? [];
  const tool = String(formData.get("tool") ?? "");
  const node = String(formData.get("node") ?? "");
  if (!graph.isGraphTool(tool)) return { runs, error: "Ferramenta desconhecida." };
  if (!graph.parseRef(node)) return { runs, error: "Referência de entidade inválida." };
  const c = await actionContext("graph-action");
  if (!c.ok) return { runs, error: c.message };
  try {
    const result = await withTenant(c.ctx.pool, c.ctx.identity, c.ctx.tenantId, (db) => graph.runGraphTool(graph.createGraphReader(graph.createSqlGraphStore(db)), tool, node, new Date()));
    return { runs: [...runs, result].slice(-MAX_RUNS) };
  } catch (e) {
    return { runs, error: explainFailure("graph-action", e) };
  }
}
