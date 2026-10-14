// Transporte das fontes (ADR-023, seção 3): somente HTTPS público, limite de tempo e de tamanho, User-Agent identificado, sem credenciais embutidas.
export interface FetchResponse {
  readonly ok: boolean; readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal; redirect?: "follow" | "error" | "manual" }) => Promise<FetchResponse>;

export type SourceErrorCode = "invalid_url" | "timeout" | "network" | "http" | "too_large" | "parse" | "robots_denied" | "robots_unavailable";
export class SourceError extends Error {
  constructor(readonly code: SourceErrorCode, message: string, readonly retryable: boolean, readonly status?: number) { super(message); this.name = "SourceError"; }
}

const PRIVATE_V4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
/** Só HTTPS, sem credenciais, porta padrão, e nome que não aponte para a máquina local nem para rede privada. */
export function checkPublicUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new SourceError("invalid_url", `URL inválida: ${raw.slice(0, 80)}`, false); }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (u.protocol !== "https:") throw new SourceError("invalid_url", "só HTTPS é aceito", false);
  if (u.username || u.password) throw new SourceError("invalid_url", "URL com credenciais embutidas", false);
  if (u.port && u.port !== "443") throw new SourceError("invalid_url", "porta não padrão", false);
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "" || !host.includes(".") && !host.includes(":")) throw new SourceError("invalid_url", "host local ou interno", false);
  if (PRIVATE_V4.test(host) || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) throw new SourceError("invalid_url", "endereço de rede privada", false);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) throw new SourceError("invalid_url", "IP literal não é aceito (use o nome do host)", false);
  return u;
}

export interface HttpOptions { readonly userAgent: string; readonly timeoutMs?: number; readonly maxBytes?: number; readonly accept?: string }
export interface HttpResult { readonly status: number; readonly contentType: string; readonly text: string; readonly bytes: number }
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 2_000_000;

async function readCapped(res: FetchResponse, maxBytes: number): Promise<{ text: string; bytes: number }> {
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > maxBytes) throw new SourceError("too_large", `a resposta anuncia ${len} bytes (máximo ${maxBytes})`, false);
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel().catch(() => undefined); throw new SourceError("too_large", `a resposta passou de ${maxBytes} bytes`, false); }
      chunks.push(value);
    }
    return { text: new TextDecoder("utf-8").decode(Buffer.concat(chunks)), bytes: total };
  }
  const text = await res.text();
  const bytes = Buffer.byteLength(text);
  if (bytes > maxBytes) throw new SourceError("too_large", `a resposta passou de ${maxBytes} bytes`, false);
  return { text, bytes };
}

export async function httpGet(fetchFn: FetchLike, url: string, opts: HttpOptions): Promise<HttpResult> {
  checkPublicUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { headers: { "User-Agent": opts.userAgent, Accept: opts.accept ?? "*/*", "Accept-Encoding": "gzip" }, signal: controller.signal, redirect: "follow" });
    if (!res.ok) throw new SourceError("http", `HTTP ${res.status}`, res.status === 429 || res.status >= 500, res.status);
    const { text, bytes } = await readCapped(res, opts.maxBytes ?? DEFAULT_MAX_BYTES);
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", text, bytes };
  } catch (e) {
    if (e instanceof SourceError) throw e;
    if (controller.signal.aborted) throw new SourceError("timeout", `sem resposta em ${(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s`, true);
    throw new SourceError("network", `falha de rede: ${(e as Error).name}`, true);
  } finally { clearTimeout(timer); }
}
