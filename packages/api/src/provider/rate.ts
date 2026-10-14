// Intervalo mínimo entre requisições ao mesmo host (cortesia e limites documentados: GDELT 1 a cada 5 s). O relógio e o sono são injetáveis (testes sem espera real).
export class RateGate {
  private readonly last = new Map<string, number>();
  constructor(private readonly minIntervalMs: Readonly<Record<string, number>>, private readonly clock: () => number = Date.now, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}
  async wait(host: string): Promise<void> {
    const every = this.minIntervalMs[host];
    if (!every) return;
    const prev = this.last.get(host);
    if (prev !== undefined) { const gap = prev + every - this.clock(); if (gap > 0) await this.sleep(gap); }
    this.last.set(host, this.clock());
  }
}
export const PUBLIC_RATES: Readonly<Record<string, number>> = { "apisidra.ibge.gov.br": 500, "api.gdeltproject.org": 6000, "overpass-api.de": 3000 };
