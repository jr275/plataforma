import { KIND_META, RELATION_META, VERIFICATION_META, type KnowledgeGraph } from "@/lib/graph/model";
import { indexGraph, otherEnd, shortestPath } from "@/lib/graph/query";
import type { AgUiEvent, Claim, ChangeProposal, GraphAnswer, RelationRow } from "./ag-ui";

// AGENTE DEMONSTRATIVO e determinístico. Não chama modelo de linguagem nem rede: percorre o grafo de demonstração
// e emite eventos no formato AG-UI com pequenos atrasos para tornar visíveis os estados de execução.

export type AgentIntent = "explain" | "gaps" | "path" | "fail";

export type AgentInput = {
  prompt: string;
  intent: AgentIntent;
  graph: KnowledgeGraph;
  selectedId?: string;
  pathEnds?: readonly [string, string];
};

export function detectIntent(prompt: string): AgentIntent {
  const p = prompt.toLowerCase();
  if (p.includes("falha") || p.includes("erro")) return "fail";
  if (p.includes("lacuna") || p.includes("evidência fraca") || p.includes("gap")) return "gaps";
  if (p.includes("caminho") || p.includes("conecta")) return "path";
  return "explain";
}

class AbortedError extends Error {}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new AbortedError());
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); reject(new AbortedError()); }, { once: true });
  });

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export const isAbort = (e: unknown) => e instanceof AbortedError;

export async function* runMockGraphAgent(input: AgentInput, signal: AbortSignal): AsyncGenerator<AgUiEvent> {
  const threadId = `thread-${input.graph.tenantId}`;
  const runId = uid("run");
  const messageId = uid("msg");
  const index = indexGraph(input.graph);
  const subject = input.selectedId ? index.byId.get(input.selectedId) : undefined;

  yield { type: "RUN_STARTED", threadId, runId };

  async function* tool(name: string, args: object, result: () => unknown, ms = 650): AsyncGenerator<AgUiEvent> {
    const toolCallId = uid("tool");
    yield { type: "TOOL_CALL_START", toolCallId, toolCallName: name, parentMessageId: messageId };
    yield { type: "TOOL_CALL_ARGS", toolCallId, delta: JSON.stringify(args) };
    await sleep(ms, signal);
    yield { type: "TOOL_CALL_END", toolCallId };
    yield { type: "TOOL_CALL_RESULT", toolCallId, messageId, content: JSON.stringify(result()) };
  }

  async function* say(text: string): AsyncGenerator<AgUiEvent> {
    yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" };
    for (const word of text.split(/(?<=\s)/)) {
      await sleep(26, signal);
      yield { type: "TEXT_MESSAGE_CONTENT", messageId, delta: word };
    }
    yield { type: "TEXT_MESSAGE_END", messageId };
  }

  yield { type: "STEP_STARTED", stepName: "Ler contexto da investigação" };
  await sleep(350, signal);
  yield { type: "STEP_FINISHED", stepName: "Ler contexto da investigação" };

  if (input.intent === "fail") {
    yield* tool("graph.get_neighbors", { nodeId: subject?.id ?? null }, () => ({ ok: true }), 500);
    yield { type: "STEP_STARTED", stepName: "Consultar índice de evidências" };
    await sleep(700, signal);
    yield { type: "RUN_ERROR", message: "O índice de evidências não respondeu (falha simulada para demonstrar o estado de erro). Nenhuma alteração foi feita.", code: "DEMO_EVIDENCE_TIMEOUT" };
    return;
  }

  if (input.intent === "path") {
    const ends = input.pathEnds;
    const path = ends ? shortestPath(index, ends[0], ends[1]) : null;
    yield* tool("graph.shortest_path", { from: ends?.[0] ?? null, to: ends?.[1] ?? null }, () => path ?? { found: false });
    if (!ends || !path) {
      yield* say(ends ? "Não encontrei um caminho entre as duas entidades no grafo atual." : "Para explicar um caminho, selecione uma entidade e use \"Traçar caminho\" até outra no grafo. Depois peça de novo.");
      yield { type: "RUN_FINISHED", threadId, runId };
      return;
    }
    const claims: Claim[] = path.edgeIds.map((eid, i) => {
      const e = index.edgeById.get(eid)!;
      const s = index.byId.get(e.source)!;
      const t = index.byId.get(e.target)!;
      return {
        id: `c-${i}`,
        kind: e.verification === "verified" ? "fact" : "inference",
        text: `${s.label} ${RELATION_META[e.type].label} ${t.label}.`,
        nodeIds: [s.id, t.id],
        edgeIds: [eid],
        evidenceIds: e.evidenceIds,
      };
    });
    yield { type: "CUSTOM", name: "graph.highlight", value: { nodeIds: path.nodeIds, edgeIds: path.edgeIds } };
    const from = index.byId.get(ends[0])!;
    const to = index.byId.get(ends[1])!;
    yield* say(`${from.label} e ${to.label} se conectam em ${path.edgeIds.length} ${path.edgeIds.length === 1 ? "passo" : "passos"}. ${claims.filter((c) => c.kind === "fact").length} trechos têm evidência verificada; os demais são inferências do modelo do domínio.`);
    yield { type: "CUSTOM", name: "graph.answer", value: { title: `Caminho: ${from.label} → ${to.label}`, claims, rows: [] } };
    yield { type: "RUN_FINISHED", threadId, runId };
    return;
  }

  if (!subject) {
    yield* say("Selecione um nó no grafo para que eu possa analisar as relações dele. Vou usar a seleção atual como contexto, sem sair da sua investigação.");
    yield { type: "RUN_FINISHED", threadId, runId };
    return;
  }

  const incident = index.incident.get(subject.id) ?? [];
  yield* tool("graph.get_neighbors", { nodeId: subject.id, depth: 1 }, () => ({ count: incident.length }));
  const evidenceIds = [...new Set(incident.flatMap((e) => e.evidenceIds))];
  yield* tool("graph.collect_evidence", { nodeId: subject.id }, () => ({ facts: evidenceIds.length }), 800);

  const rows: RelationRow[] = incident.map((e) => ({
    edgeId: e.id,
    relation: RELATION_META[e.type].label,
    direction: e.source === subject.id ? "out" : "in",
    otherId: otherEnd(e, subject.id),
    verification: VERIFICATION_META[e.verification].label,
    evidenceCount: e.evidenceIds.length,
  }));

  const domainEdges = incident.filter((e) => KIND_META[index.byId.get(otherEnd(e, subject.id))!.kind].layer === "domain");
  const claims: Claim[] = [];
  const proposalTargets: ChangeProposal[] = [];

  if (input.intent === "explain") {
    for (const e of domainEdges) {
      const other = index.byId.get(otherEnd(e, subject.id))!;
      const phrase = e.source === subject.id ? `${subject.label} ${RELATION_META[e.type].label} ${other.label}` : `${other.label} ${RELATION_META[e.type].label} ${subject.label}`;
      if (e.verification === "verified") claims.push({ id: `c-${e.id}`, kind: "fact", text: `${phrase}.`, nodeIds: [other.id], edgeIds: [e.id], evidenceIds: e.evidenceIds });
      else claims.push({ id: `c-${e.id}`, kind: "inference", text: `${phrase} — relação ${e.evidenceIds.length ? "com evidência ainda não revisada" : "inferida do modelo, sem fato que a sustente"}.`, nodeIds: [other.id], edgeIds: [e.id], evidenceIds: e.evidenceIds });
      if (e.verification !== "verified" && e.evidenceIds.length) proposalTargets.push({ id: uid("prop"), title: `Marcar como verificada: ${phrase}`, description: `A relação tem ${e.evidenceIds.length} fato(s) associado(s). Aprovar registra a verificação como curadoria humana.`, change: { kind: "verify_edge", edgeId: e.id } });
    }
    const facts = incident.map((e) => index.byId.get(otherEnd(e, subject.id))!).filter((n) => n.kind === "fact");
    for (const f of facts) {
      claims.push({ id: `c-${f.id}`, kind: f.verification === "verified" ? "fact" : "inference", text: f.verification === "verified" ? f.summary : `${f.summary} (fato ${VERIFICATION_META[f.verification].label.toLowerCase()})`, nodeIds: [f.id], edgeIds: [], evidenceIds: [f.id] });
    }
  }

  const weak = incident.filter((e) => e.verification !== "verified");
  for (const e of weak.slice(0, input.intent === "gaps" ? 6 : 2)) {
    const other = index.byId.get(otherEnd(e, subject.id))!;
    claims.push({ id: `s-${e.id}`, kind: "suggestion", text: e.evidenceIds.length ? `Revisar a evidência da relação com ${other.label}.` : `Buscar um fato com fonte que sustente a relação com ${other.label}.`, nodeIds: [other.id], edgeIds: [e.id], evidenceIds: e.evidenceIds });
  }
  const expired = incident.map((e) => index.byId.get(otherEnd(e, subject.id))!).find((n) => n.kind === "fact" && n.verification === "expired");
  if (expired) proposalTargets.push({ id: uid("prop"), title: `Sinalizar revalidação: ${expired.label}`, description: "O fato está expirado. Aprovar marca o nó como pendente de revalidação nesta sessão.", change: { kind: "flag_revalidation", nodeId: expired.id } });

  const highlightEdges = (input.intent === "gaps" ? weak : incident).map((e) => e.id);
  yield { type: "CUSTOM", name: "graph.highlight", value: { nodeIds: [subject.id, ...highlightEdges.map((id) => otherEnd(index.edgeById.get(id)!, subject.id))], edgeIds: highlightEdges } };

  const verifiedCount = domainEdges.filter((e) => e.verification === "verified").length;
  const text =
    input.intent === "gaps"
      ? weak.length
        ? `${subject.label} tem ${weak.length} relação(ões) sem verificação. Destaquei-as no grafo; abaixo estão as lacunas e o que resolveria cada uma.`
        : `Todas as relações de ${subject.label} estão verificadas. Nenhuma lacuna encontrada no grafo atual.`
      : `${subject.label} (${KIND_META[subject.kind].label.toLowerCase()}) tem ${domainEdges.length} relação(ões) de domínio, ${verifiedCount} com evidência verificada, e ${evidenceIds.length} fato(s) associado(s). Destaquei a vizinhança no grafo. Separei abaixo o que é fato, o que é inferência e o que é sugestão.`;
  yield* say(text);

  const answer: GraphAnswer = { title: input.intent === "gaps" ? `Lacunas de evidência · ${subject.label}` : `Relações de ${subject.label}`, subjectId: subject.id, claims, rows };
  yield { type: "CUSTOM", name: "graph.answer", value: answer };

  if (proposalTargets[0]) {
    yield { type: "STEP_STARTED", stepName: "Preparar proposta de alteração" };
    await sleep(400, signal);
    yield { type: "STEP_FINISHED", stepName: "Preparar proposta de alteração" };
    yield { type: "CUSTOM", name: "approval.request", value: proposalTargets[0] };
  }

  yield { type: "RUN_FINISHED", threadId, runId };
}
