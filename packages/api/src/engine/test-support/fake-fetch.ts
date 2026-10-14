import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FetchLike, FetchResponse } from "../http";

export const fixture = (name: string): string => readFileSync(fileURLToPath(new URL(`../adapters/__fixtures__/${name}`, import.meta.url)), "utf8");

export interface Route { readonly status?: number; readonly body?: string; readonly headers?: Record<string, string>; readonly hang?: boolean; readonly throws?: Error; readonly stream?: boolean }
/** `fetch` falso: casa pela URL exata ou por prefixo; registra as chamadas. Respostas de sucesso vêm de fixtures REAIS; as falhas são forçadas aqui. */
export function fakeFetch(routes: Record<string, Route>, calls: { url: string; headers: Record<string, string> }[] = []): FetchLike {
  return async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const key = Object.keys(routes).find((k) => url === k || url.startsWith(k));
    if (!key) throw new Error(`rota não prevista no teste: ${url}`);
    const r = routes[key]!;
    if (r.throws) throw r.throws;
    if (r.hang) await new Promise<never>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const status = r.status ?? 200;
    const body = r.body ?? "";
    const headers = new Map(Object.entries({ "content-type": "text/plain", ...(r.headers ?? {}) }).map(([k, v]) => [k.toLowerCase(), v]));
    const res: FetchResponse = {
      ok: status >= 200 && status < 300, status, headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
      body: r.stream ? new ReadableStream<Uint8Array>({ start(c) { const b = new TextEncoder().encode(body); for (let i = 0; i < b.length; i += 1024) c.enqueue(b.slice(i, i + 1024)); c.close(); } }) : null,
      text: async () => body,
    };
    return res;
  };
}
