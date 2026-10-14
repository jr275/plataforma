// Controle de custo (brief da unidade 2): teto de US$ 50 para toda a unidade e limite de requisições por execução (padrão 500, configurável).
// Só requisições REAIS contam (resposta do cache é gratuita). O teto global vem do que está gravado em `provider_call`, não de memória do processo.
export const UNIT_CAP_USD = 50;
export const DEFAULT_MAX_REQUESTS_PER_RUN = 500;

export class BudgetExceededError extends Error {
  constructor(readonly reason: "requests" | "cost", message: string) { super(message); this.name = "BudgetExceededError"; }
}

export interface BudgetLimits { readonly maxRequests: number; readonly capUsd: number; /** Quanto já foi gasto antes desta execução (soma gravada). */ readonly spentBeforeUsd: number }
export class RunBudget {
  private requests = 0;
  private spent = 0;
  constructor(readonly limits: BudgetLimits) {
    if (!Number.isInteger(limits.maxRequests) || limits.maxRequests < 1) throw new RangeError("maxRequests deve ser um inteiro ≥ 1");
    if (!(limits.capUsd > 0) || limits.spentBeforeUsd < 0) throw new RangeError("teto de custo inválido");
  }
  static create(o: { spentBeforeUsd?: number; maxRequests?: number; capUsd?: number } = {}): RunBudget {
    return new RunBudget({ maxRequests: o.maxRequests ?? DEFAULT_MAX_REQUESTS_PER_RUN, capUsd: o.capUsd ?? UNIT_CAP_USD, spentBeforeUsd: o.spentBeforeUsd ?? 0 });
  }
  /** Autoriza UMA requisição nova, ou lança. `estimateUsd` é o pior caso conhecido do endpoint (0 para gratuitos). */
  reserve(estimateUsd = 0): void {
    if (this.requests >= this.limits.maxRequests) throw new BudgetExceededError("requests", `limite de ${this.limits.maxRequests} requisições por execução atingido`);
    if (this.limits.spentBeforeUsd + this.spent + estimateUsd > this.limits.capUsd) throw new BudgetExceededError("cost", `o teto de US$ ${this.limits.capUsd} da unidade seria ultrapassado`);
    this.requests += 1;
  }
  /** Registra o custo real depois da resposta. */
  settle(costUsd: number): void { if (costUsd > 0) this.spent += costUsd; }
  get usage(): { requests: number; costUsd: number; remainingRequests: number; remainingUsd: number } {
    return { requests: this.requests, costUsd: Number(this.spent.toFixed(6)), remainingRequests: this.limits.maxRequests - this.requests, remainingUsd: Number((this.limits.capUsd - this.limits.spentBeforeUsd - this.spent).toFixed(6)) };
  }
}
