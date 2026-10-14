import { addDays, type EvidenceDraft } from "../evidence";
import { SourceError, httpGet } from "../http";
import { finish, type AdapterContext, type AdapterError, type AdapterResult, type SourceAdapter } from "./types";

// Banco Central do Brasil, Sistema Gerenciador de Séries Temporais (dados abertos, sem credencial). Cada série vira UM registro de indicador: o último valor
// publicado (métrica do provedor) e a variação calculada (derivada, com o método descrito). Datas FUTURAS que a série devolve são descartadas.
export const BCB_ID = "bcb-sgs";
const BASE = "https://api.bcb.gov.br/dados/serie/bcdata.sgs";

export interface Point { readonly date: string; readonly time: number; readonly value: number }
const dmy = (s: string): { y: number; m: number; d: number } | null => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); return m ? { d: +m[1]!, m: +m[2]!, y: +m[3]! } : null; };
const iso = (p: { y: number; m: number; d: number }) => `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
const fmtDmy = (t: Date) => `${String(t.getUTCDate()).padStart(2, "0")}/${String(t.getUTCMonth() + 1).padStart(2, "0")}/${t.getUTCFullYear()}`;
/** Data civil em São Paulo (UTC-3, sem horário de verão desde 2019), como `Date` à meia-noite UTC. */
export const brToday = (now: Date): Date => { const x = new Date(now.getTime() - 3 * 3_600_000); return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate())); };
const pt = (n: number, d = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** Converte a resposta do SGS em pontos válidos; descarta (e conta) linhas malformadas e datas futuras. */
export function parseSgs(json: unknown, today: Date): { points: Point[]; invalid: number; future: number } {
  if (!Array.isArray(json)) throw new SourceError("parse", "a resposta do SGS não é uma lista", false);
  const points: Point[] = [];
  let invalid = 0, future = 0;
  for (const row of json as unknown[]) {
    const r = row as { data?: unknown; valor?: unknown } | null;
    const d = typeof r?.data === "string" ? dmy(r.data) : null;
    const v = typeof r?.valor === "string" || typeof r?.valor === "number" ? Number(r.valor) : NaN;
    if (!d || !Number.isFinite(v)) { invalid++; continue; }
    const time = Date.UTC(d.y, d.m - 1, d.d);
    if (time > today.getTime()) { future++; continue; }
    points.push({ date: iso(d), time, value: v });
  }
  points.sort((a, b) => a.time - b.time);
  return { points, invalid, future };
}

export interface SeriesCfg { readonly id: number; readonly label: string; readonly unit: string; readonly frequency: "daily" | "monthly"; readonly topic: string }
const DAY = 86_400_000;
export const SGS_TIMEOUT_MS = 25_000;

/** Monta o registro de indicador a partir dos pontos (função pura). `null` se não houver nenhum ponto válido. */
export function indicatorEvidence(cfg: SeriesCfg, points: readonly Point[], url: string, now: Date, counts: { invalid: number; future: number }): EvidenceDraft | null {
  const latest = points[points.length - 1];
  if (!latest) return null;
  const refTime = cfg.frequency === "daily" ? latest.time - 90 * DAY : null;
  const ref = cfg.frequency === "daily" ? [...points].reverse().find((p) => p.time <= refTime!) ?? null : points[points.length - 2] ?? null;
  const delta = ref ? Math.round((latest.value - ref.value) * 10000) / 10000 : null;
  const direction = delta === null ? "unknown" : delta > 0 ? "up" : delta < 0 ? "down" : "stable";
  let lastChange: { date: string; from: number; to: number } | null = null;
  for (let i = points.length - 1; i > 0; i--) if (points[i]!.value !== points[i - 1]!.value) { lastChange = { date: points[i]!.date, from: points[i - 1]!.value, to: points[i]!.value }; break; }
  const window = cfg.frequency === "daily" ? "90 dias" : "o mês anterior";
  const dirText = direction === "unknown" ? "sem ponto de comparação" : direction === "stable" ? `estável em relação a ${window}` : `${direction === "up" ? "alta" : "queda"} de ${pt(Math.abs(delta!))} em relação a ${window}`;
  const when = fmtDmy(new Date(latest.time));
  const limitations = [
    "Indicador macroeconômico oficial: contextualiza o tema, mas não mede demanda de busca.",
    `Variação calculada pelo sistema (${cfg.frequency === "daily" ? "valor mais recente menos o valor de 90 dias antes" : "valor mais recente menos o do mês anterior"}); não é métrica do BCB.`,
    ...(counts.future > 0 ? [`${counts.future} ponto(s) com data futura foram descartados.`] : []),
    ...(counts.invalid > 0 ? [`${counts.invalid} linha(s) malformada(s) foram descartadas.`] : []),
  ];
  return {
    adapter: BCB_ID, kind: "indicator", sourceRef: `${BCB_ID}:${cfg.id}`, url,
    title: `${cfg.label}: ${pt(latest.value)} ${cfg.unit} (${when})`,
    summary: `${dirText}.${lastChange ? ` Última alteração em ${fmtDmy(new Date(Date.parse(lastChange.date)))}: de ${pt(lastChange.from)} para ${pt(lastChange.to)}.` : ""}`,
    publishedAt: new Date(latest.time + 12 * 3_600_000), collectedAt: now,
    validUntil: addDays(now, cfg.frequency === "daily" ? 7 : 45), basis: "provider_metric",
    payload: { seriesId: cfg.id, label: cfg.label, unit: cfg.unit, frequency: cfg.frequency, topic: cfg.topic, latest: { date: latest.date, value: latest.value }, reference: ref ? { date: ref.date, value: ref.value } : null, delta, direction, lastChange, points: points.length, recent: points.slice(-12).map((p) => ({ date: p.date, value: p.value })) },
    topics: [cfg.topic], limitations,
  };
}

export const bcbSgsAdapter: SourceAdapter = {
  id: BCB_ID, label: "Banco Central do Brasil: séries temporais (SGS)", provider: "Banco Central do Brasil", kind: "indicator",
  docsUrl: "https://dadosabertos.bcb.gov.br/", terms: "Dados abertos do Banco Central do Brasil; sem credencial; uso conforme a política de dados abertos.",
  async run(ctx: AdapterContext): Promise<AdapterResult> {
    const started = Date.now();
    const evidence: EvidenceDraft[] = [], errors: AdapterError[] = [], limitations: string[] = [];
    let requests = 0, bytes = 0, seen = 0;
    const today = brToday(ctx.now);
    const series = ctx.vertical.sources.bcbSeries;
    for (const cfg of series) {
      const start = new Date(today.getTime() - (cfg.frequency === "daily" ? 130 : 400) * DAY);
      const url = `${BASE}.${cfg.id}/dados?formato=json&dataInicial=${fmtDmy(start)}&dataFinal=${fmtDmy(today)}`;
      try {
        // O gateway do BCB oscila (medido em 2026-10-13: de 0,5 s a 30 s para a MESMA consulta). Prazo maior e UMA nova tentativa, só para falha transitória.
        let r: Awaited<ReturnType<typeof httpGet>>;
        try { requests++; r = await httpGet(ctx.fetch, url, { userAgent: ctx.userAgent, accept: "application/json", timeoutMs: SGS_TIMEOUT_MS }); }
        catch (first) {
          if (!(first instanceof SourceError) || !first.retryable) throw first;
          await ctx.sleep(1000);
          requests++;
          r = await httpGet(ctx.fetch, url, { userAgent: ctx.userAgent, accept: "application/json", timeoutMs: SGS_TIMEOUT_MS });
        }
        bytes += r.bytes;
        let json: unknown;
        try { json = JSON.parse(r.text); } catch { throw new SourceError("parse", "a resposta do SGS não é JSON", false); }
        const parsed = parseSgs(json, today);
        seen += parsed.points.length;
        const ev = indicatorEvidence(cfg, parsed.points, url, ctx.now, parsed);
        if (!ev) throw new SourceError("parse", "a série não devolveu nenhum ponto válido", false);
        evidence.push(ev);
      } catch (e) {
        const se = e instanceof SourceError ? e : new SourceError("network", "falha inesperada", true);
        errors.push({ target: `sgs.${cfg.id}`, code: se.code, message: se.message, retryable: se.retryable });
      }
    }
    limitations.push("Séries macroeconômicas contextualizam temas de crédito e preços; não são volume de busca.");
    return finish(BCB_ID, started, Date.now, { evidence, errors, requests, bytes, seen, kept: evidence.length, limitations, attempted: series.length });
  },
};
