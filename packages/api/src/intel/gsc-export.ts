// Export do Search Console → snapshot agregado (ADR-026). Módulo puro: sem E/S, sem marca, sem termo de domínio.
// Nada aqui inventa número: tudo vem das tabelas do export. Totais saem da tabela de dispositivos (cobre todo o tráfego).

export interface GscExportRow {
  readonly key: string;
  readonly clicks: number;
  readonly prevClicks: number;
  readonly impressions: number;
  readonly prevImpressions: number;
  readonly ctr: number;
  readonly prevCtr: number;
  readonly position: number;
  readonly prevPosition: number;
}

export interface GscExportTotals {
  readonly clicks: number;
  readonly impressions: number;
  /** Em porcentagem (cliques ÷ impressões × 100). */
  readonly ctr: number;
  /** Média ponderada por impressões das linhas de dispositivo. */
  readonly position: number;
}

export interface GscDailyPoint {
  /** AAAA-MM-DD, como no export. */
  readonly date: string;
  readonly clicks: number;
  readonly impressions: number;
  /** Em porcentagem. */
  readonly ctr: number;
  readonly position: number;
}

export interface GscExportSnapshot {
  readonly version: 1;
  readonly source: "gsc_export";
  readonly tenantId: string | null;
  readonly property: string;
  readonly exportedAt: string;
  readonly searchType: string;
  readonly period: string;
  readonly current: GscExportTotals;
  readonly previous: GscExportTotals;
  readonly devices: readonly GscExportRow[];
  readonly appearances: readonly GscExportRow[];
  readonly countries: readonly GscExportRow[];
  /** O que as listas exportadas cobrem do total: o Google omite a cauda anônima e corta o export. */
  readonly coverage: {
    readonly queries: { readonly rows: number; readonly clicks: number; readonly impressions: number; readonly clicksShare: number; readonly impressionsShare: number };
    readonly pages: { readonly rows: number; readonly clicks: number; readonly clicksShare: number };
  };
  /** Série diária (aba "Datas" do export). Pode vir de outra propriedade que o resto do snapshot, por isso carrega a sua. */
  readonly daily?: { readonly property: string; readonly points: readonly GscDailyPoint[] };
  /** As maiores consultas e páginas por cliques (dado do cliente: o snapshot vive só em arquivo local, fora do Git). Ausente em snapshots antigos. */
  readonly top?: { readonly queries: readonly GscExportRow[]; readonly pages: readonly GscExportRow[] };
  readonly ai: null | {
    readonly impressions: number;
    readonly prevImpressions: number;
    readonly pages: number;
    /** As páginas com mais impressões em recursos de IA (só impressões). */
    readonly topPages?: readonly { readonly key: string; readonly impressions: number; readonly prevImpressions: number }[];
    readonly countries: readonly { readonly key: string; readonly impressions: number }[];
    readonly devices: readonly { readonly key: string; readonly impressions: number }[];
  };
}

/** CSV mínimo (RFC 4180): campos entre aspas, aspas duplicadas e quebras de linha dentro do campo. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function num(v: string | undefined): number {
  if (v === undefined) return 0;
  const n = Number(v.replace(/%/g, "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function rowsOf(text: string): { header: string[]; body: string[][] } {
  const all = parseCsv(text);
  return { header: all[0] ?? [], body: all.slice(1) };
}

/** Colunas do export de desempenho: Chave, cliques (atual, anterior), impressões (atual, anterior), CTR, posição. */
function metricRows(text: string): GscExportRow[] {
  const { header, body } = rowsOf(text);
  if (header.length < 9) throw new Error("export de desempenho com colunas inesperadas");
  return body.map((r) => ({
    key: r[0] ?? "",
    clicks: num(r[1]), prevClicks: num(r[2]),
    impressions: num(r[3]), prevImpressions: num(r[4]),
    ctr: num(r[5]), prevCtr: num(r[6]),
    position: num(r[7]), prevPosition: num(r[8]),
  }));
}

function totals(rows: readonly GscExportRow[], prev: boolean): GscExportTotals {
  const clicks = rows.reduce((s, r) => s + (prev ? r.prevClicks : r.clicks), 0);
  const impressions = rows.reduce((s, r) => s + (prev ? r.prevImpressions : r.impressions), 0);
  const weighted = rows.reduce((s, r) => s + (prev ? r.prevPosition * r.prevImpressions : r.position * r.impressions), 0);
  return { clicks, impressions, ctr: impressions > 0 ? (clicks / impressions) * 100 : 0, position: impressions > 0 ? weighted / impressions : 0 };
}

function aiRows(text: string): { key: string; impressions: number; prevImpressions: number }[] {
  const { header, body } = rowsOf(text);
  if (header.length < 3) throw new Error("export de IA generativa com colunas inesperadas");
  return body.map((r) => ({ key: r[0] ?? "", impressions: num(r[1]), prevImpressions: num(r[2]) }));
}

/** CSV da aba "Datas": Date, Clicks, Impressions, CTR, Position (com ou sem colunas de comparação: vale a primeira de cada). */
export function parseDailySeries(text: string): GscDailyPoint[] {
  const { header, body } = rowsOf(text);
  const idx = (re: RegExp) => header.findIndex((h) => re.test(h.trim()));
  const [d, c, i, t, p] = [idx(/^date$/i), idx(/click/i), idx(/impression/i), idx(/ctr/i), idx(/position/i)];
  if ([d, c, i, t, p].some((n) => n < 0)) throw new Error("série diária com cabeçalho inesperado (esperado: Date, Clicks, Impressions, CTR, Position em inglês)");
  const seen = new Set<string>();
  const points = body.map((r) => {
    const date = (r[d] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`série diária com data inválida: "${date}"`);
    if (seen.has(date)) throw new Error(`série diária com data repetida: ${date}`);
    seen.add(date);
    return { date, clicks: num(r[c]), impressions: num(r[i]), ctr: num(r[t]), position: num(r[p]) };
  });
  if (points.length === 0) throw new Error("série diária vazia");
  return points.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface GscExportFiles {
  readonly devices: string;
  readonly countries: string;
  readonly appearances: string;
  readonly queries: string;
  readonly pages: string;
  readonly filters: string;
  /** Opcional: export de recursos de IA generativa (só impressões). */
  readonly ai?: { readonly pages: string; readonly countries: string; readonly devices: string };
  /** Opcional: aba "Datas" e a propriedade de onde ela veio. */
  readonly dates?: { readonly csv: string; readonly property: string };
}

export interface GscExportMeta { readonly property: string; readonly exportedAt: string; readonly tenantId: string | null }

const TOP_COUNTRIES = 10;
export const TOP_LIST = 50;

export function buildGscExportSnapshot(files: GscExportFiles, meta: GscExportMeta): GscExportSnapshot {
  const devices = metricRows(files.devices);
  if (devices.length === 0) throw new Error("export sem linhas de dispositivo: não há como calcular os totais");
  const current = totals(devices, false);
  const previous = totals(devices, true);
  const countries = metricRows(files.countries).sort((a, b) => b.clicks - a.clicks).slice(0, TOP_COUNTRIES);
  const queries = metricRows(files.queries);
  const pages = metricRows(files.pages);
  const qClicks = queries.reduce((s, r) => s + r.clicks, 0);
  const qImpr = queries.reduce((s, r) => s + r.impressions, 0);
  const pClicks = pages.reduce((s, r) => s + r.clicks, 0);
  const filters = new Map(rowsOf(files.filters).body.map((r) => [r[0] ?? "", r[1] ?? ""]));
  const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

  let ai: GscExportSnapshot["ai"] = null;
  if (files.ai) {
    const aiPages = aiRows(files.ai.pages);
    const impressions = aiPages.reduce((s, r) => s + r.impressions, 0);
    ai = {
      impressions,
      prevImpressions: aiPages.reduce((s, r) => s + r.prevImpressions, 0),
      pages: aiPages.filter((r) => r.impressions > 0).length,
      topPages: [...aiPages].sort((a, b) => b.impressions - a.impressions).slice(0, TOP_LIST).filter((r) => r.impressions > 0),
      countries: aiRows(files.ai.countries).sort((a, b) => b.impressions - a.impressions).slice(0, TOP_COUNTRIES).map(({ key, impressions: i }) => ({ key, impressions: i })),
      devices: aiRows(files.ai.devices).sort((a, b) => b.impressions - a.impressions).map(({ key, impressions: i }) => ({ key, impressions: i })),
    };
  }

  return {
    version: 1,
    source: "gsc_export",
    tenantId: meta.tenantId,
    property: meta.property,
    exportedAt: meta.exportedAt,
    searchType: filters.get("Search type") ?? "",
    period: filters.get("Date") ?? "",
    current, previous, devices,
    appearances: metricRows(files.appearances).filter((r) => r.impressions > 0 || r.clicks > 0),
    countries,
    ...(files.dates ? { daily: { property: files.dates.property, points: parseDailySeries(files.dates.csv) } } : {}),
    top: { queries: [...queries].sort((a, b) => b.clicks - a.clicks).slice(0, TOP_LIST), pages: [...pages].sort((a, b) => b.clicks - a.clicks).slice(0, TOP_LIST) },
    coverage: {
      queries: { rows: queries.length, clicks: qClicks, impressions: qImpr, clicksShare: share(qClicks, current.clicks), impressionsShare: share(qImpr, current.impressions) },
      pages: { rows: pages.length, clicks: pClicks, clicksShare: share(pClicks, current.clicks) },
    },
    ai,
  };
}

/** Valida um JSON lido do disco antes de a tela usá-lo (arquivo editado à mão ou de outra versão não passa). */
export function parseGscExportSnapshot(raw: unknown): GscExportSnapshot | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Partial<GscExportSnapshot>;
  const okTotals = (t: unknown) => typeof t === "object" && t !== null && ["clicks", "impressions", "ctr", "position"].every((k) => Number.isFinite((t as Record<string, unknown>)[k]));
  if (s.version !== 1 || s.source !== "gsc_export") return null;
  if (typeof s.property !== "string" || typeof s.exportedAt !== "string" || !okTotals(s.current) || !okTotals(s.previous)) return null;
  if (!Array.isArray(s.devices) || !Array.isArray(s.appearances) || !Array.isArray(s.countries) || !s.coverage) return null;
  if (s.tenantId !== null && typeof s.tenantId !== "string") return null;
  if (s.daily !== undefined && (typeof s.daily.property !== "string" || !Array.isArray(s.daily.points))) return null;
  if (s.top !== undefined && (!Array.isArray(s.top.queries) || !Array.isArray(s.top.pages))) return null;
  return s as GscExportSnapshot;
}
