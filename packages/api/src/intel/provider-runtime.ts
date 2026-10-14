import { createHash } from "node:crypto";
import type { ProviderName } from "./provider-status";

// Cache com chave determinística e teto de custo (regra 3.6). O armazenamento é injetado: em produção, a tabela
// provider_call_log/cache no Postgres; nos testes, memória. Nenhuma chamada sai sem passar pelo orçamento.

export const UNIT_BUDGET_USD = 30;
export const DEFAULT_RUN_REQUEST_LIMIT = 300;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function cacheKey(provider: ProviderName, endpoint: string, params: unknown): string {
  return `${provider}:${endpoint}:${createHash("sha256").update(stable(params)).digest("hex").slice(0, 32)}`;
}

export interface CachedResponse {
  readonly body: unknown;
  readonly collectedAt: string;
  readonly costUsd: number;
}

export interface ProviderCache {
  get(key: string): Promise<CachedResponse | null>;
  set(key: string, value: CachedResponse): Promise<void>;
}

export function memoryCache(): ProviderCache {
  const store = new Map<string, CachedResponse>();
  return {
    async get(key) { return store.get(key) ?? null; },
    async set(key, value) { store.set(key, value); },
  };
}

export interface CallLogEntry {
  readonly provider: ProviderName;
  readonly endpoint: string;
  readonly cacheKey: string;
  readonly cacheHit: boolean;
  readonly costUsd: number;
  readonly ok: boolean;
}

export class BudgetExceededError extends Error {
  constructor(readonly kind: "requests" | "usd", detail: string) {
    super(detail);
    this.name = "BudgetExceededError";
  }
}

/** Orçamento de uma execução. Cache hit não consome requisição nem custo. */
export class RunBudget {
  private requests = 0;
  private spent = 0;
  readonly log: CallLogEntry[] = [];

  constructor(
    readonly requestLimit: number = DEFAULT_RUN_REQUEST_LIMIT,
    readonly usdLimit: number = UNIT_BUDGET_USD,
    private readonly alreadySpentUsd: number = 0,
  ) {}

  reserve(): void {
    if (this.requests >= this.requestLimit) {
      throw new BudgetExceededError("requests", `limite de ${this.requestLimit} requisições por execução atingido`);
    }
    if (this.alreadySpentUsd + this.spent >= this.usdLimit) {
      throw new BudgetExceededError("usd", `teto de US$ ${this.usdLimit} da unidade atingido`);
    }
    this.requests += 1;
  }

  record(entry: CallLogEntry): void {
    if (!entry.cacheHit) this.spent += entry.costUsd;
    this.log.push(entry);
  }

  get summary() {
    const hits = this.log.filter((e) => e.cacheHit).length;
    return {
      requests: this.requests,
      costUsd: Math.round(this.spent * 10000) / 10000,
      cacheHitRate: this.log.length ? hits / this.log.length : 0,
    };
  }
}
