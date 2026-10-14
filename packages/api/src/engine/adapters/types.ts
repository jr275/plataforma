import type { EvidenceDraft } from "../evidence";
import type { FetchLike } from "../http";
import type { Robots } from "../robots";
import type { VerticalDefinition } from "../vertical";

export interface AdapterContext {
  readonly fetch: FetchLike; readonly now: Date; readonly userAgent: string; readonly vertical: VerticalDefinition;
  readonly sleep: (ms: number) => Promise<void>;
  /** Cache de robots.txt por host, compartilhado na execução. */
  readonly robots: Map<string, Promise<Robots | "missing" | "unavailable">>;
}
export type AdapterStatus = "succeeded" | "partial" | "failed" | "skipped";
export interface AdapterError { readonly target: string; readonly code: string; readonly message: string; readonly retryable: boolean }
export interface AdapterResult {
  readonly adapter: string; readonly status: AdapterStatus;
  readonly evidence: readonly EvidenceDraft[]; readonly errors: readonly AdapterError[];
  readonly requests: number; readonly bytes: number; readonly seen: number; readonly kept: number;
  readonly limitations: readonly string[]; readonly durationMs: number;
}
export interface SourceAdapter {
  readonly id: string; readonly label: string; readonly provider: string; readonly kind: "indicator" | "news";
  readonly docsUrl: string; readonly terms: string;
  run(ctx: AdapterContext): Promise<AdapterResult>;
}

export function finish(adapter: string, started: number, now: () => number, parts: { evidence: EvidenceDraft[]; errors: AdapterError[]; requests: number; bytes: number; seen: number; kept: number; limitations: string[]; attempted: number; skipped?: number }): AdapterResult {
  const okTargets = parts.attempted - parts.errors.length;
  const status: AdapterStatus = parts.attempted === 0 ? "skipped" : parts.errors.length === 0 ? "succeeded" : okTargets > 0 ? "partial" : parts.errors.every((e) => e.code === "robots_denied") ? "skipped" : "failed";
  return { adapter, status, evidence: parts.evidence, errors: parts.errors, requests: parts.requests, bytes: parts.bytes, seen: parts.seen, kept: parts.kept, limitations: parts.limitations, durationMs: now() - started };
}
