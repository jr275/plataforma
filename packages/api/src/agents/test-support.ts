import type { FetchLike, FetchResponse } from "../engine/http";

// SOMENTE TESTES: um "LLM" roteirizado no formato documentado da Messages API. Nunca é usado em tempo de execução; nenhuma resposta aqui é de um modelo real.
export interface ScriptedCall { readonly url: string; readonly headers: Record<string, string>; readonly body: { model: string; system: string; messages: { role: string; content: string }[]; temperature: number } }
export function scriptedLlm(script: readonly (string | { status: number; body: string })[], calls: ScriptedCall[] = []): FetchLike {
  let i = 0;
  return async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {}, body: JSON.parse(init?.body ?? "{}") });
    const next = script[i++]; if (next === undefined) throw new Error(`o roteiro do LLM de teste acabou (chamada ${i})`);
    const status = typeof next === "string" ? 200 : next.status;
    const body = typeof next === "string" ? JSON.stringify({ id: `msg_${i}`, type: "message", role: "assistant", model: "claude-teste", content: [{ type: "text", text: next }], stop_reason: "end_turn", usage: { input_tokens: 100 + i, output_tokens: 20 + i } }) : next.body;
    const h = new Map([["content-type", "application/json"]]);
    return { ok: status >= 200 && status < 300, status, headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null }, body: null, text: async () => body } satisfies FetchResponse;
  };
}
