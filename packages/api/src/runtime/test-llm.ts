import type { FetchLike, FetchResponse } from "../engine/http";

// SOMENTE TESTES: LLM roteirizado POR AGENTE (lê o slug do bloco de contexto). Nenhuma resposta aqui é de um modelo real.
export type Reply = string | { status: number; body: string } | "hang";
export type Handler = (input: any, n: number) => Reply;
export const inputOf = (content: string): any => { const s = content.indexOf("{"); let depth = 0; let inStr = false; for (let i = s; i < content.length; i++) { const c = content[i]!; if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; } if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) return JSON.parse(content.slice(s, i + 1)); } throw new Error("INPUT não encontrado"); };
/** LLM roteirizado POR AGENTE (lê o slug do bloco de contexto): só testes. Cada chamada fica em `calls`. */
export function routedLlm(handlers: Partial<Record<number, Handler>>, calls: { agent: number; execution: string; correlation: string }[] = []): FetchLike {
  const n: Record<number, number> = {};
  return async (_url, init) => {
    const b = JSON.parse(init?.body ?? "{}") as { system: string; messages: { content: string }[] };
    const agent = Number(/agent: agent-0(\d)-/.exec(b.system)![1]); n[agent] = (n[agent] ?? 0) + 1;
    calls.push({ agent, execution: /execution_id: (\S+)/.exec(b.system)![1]!, correlation: /correlation_id: (\S+)/.exec(b.system)![1]! });
    const h = handlers[agent]; if (!h) throw new Error(`sem roteiro para o agente ${agent}`);
    const r = h(inputOf(b.messages[0]!.content), n[agent]!);
    if (r === "hang") return new Promise<FetchResponse>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    const status = typeof r === "string" ? 200 : r.status;
    const body = typeof r === "string" ? JSON.stringify({ id: `m${n[agent]}`, type: "message", role: "assistant", model: "claude-teste", content: [{ type: "text", text: r }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 20 } }) : r.body;
    const h2 = new Map([["content-type", "application/json"]]);
    return { ok: status >= 200 && status < 300, status, headers: { get: (k: string) => h2.get(k.toLowerCase()) ?? null }, body: null, text: async () => body };
  };
}
export const A5: Handler = (i) => JSON.stringify({ topic_id: i.topic_id, explanation: `A decisão do motor foi ${i.decision}, conforme os gates e a pontuação gravados.`, next_best_action: "Revisar os requisitos listados pelo motor." });
export const A7: Handler = (i) => JSON.stringify({ page_id: i.page_id, slots: i.narrative_slots.map((s: any) => (s.slot_id === "demografia:pop" ? { slot_id: s.slot_id, status: "OK", text: `São Paulo tem ${Number(s.facts[0].value).toLocaleString("pt-BR")} habitantes [${s.facts[0].fact_id}].`, evidence_refs: [s.facts[0].fact_id] } : { slot_id: s.slot_id, status: "INSUFFICIENT", text: "", evidence_refs: [] })) });
export const A8 = (q2: "PASS" | "FAIL" = "PASS"): Handler => (i) => JSON.stringify({ page_id: i.page_id, checks: { Q1: { result: "PASS", issues: [] }, Q2: { result: q2, issues: q2 === "FAIL" ? [{ excerpt: "x", expected: "y", found: "z" }] : [] }, Q8: { result: "PASS", issues: [] }, Q13: { result: "PASS", issues: [] }, Q14: { result: "PASS", issues: [], exclusive_value: ["população estimada e do Censo lado a lado"] } }, summary: "ok" });

