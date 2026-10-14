import { addDays, excerpt, type EvidenceDraft } from "../evidence";
import { SourceError, httpGet } from "../http";
import { fold } from "../normalize";
import { finish, type AdapterContext, type AdapterError, type AdapterResult, type SourceAdapter } from "./types";

// API de notícias do IBGE (Agência de Notícias; serviço público oficial, sem credencial). Cada notícia vira um registro com URL, título, trecho curto e data.
export const IBGE_ID = "ibge-news";
const BASE = "https://servicodados.ibge.gov.br/api/v3/noticias/";
export const MAX_AGE_DAYS = 180;
export const PER_TERM = 15;

/** "dd/mm/aaaa hh:mm:ss" no horário de Brasília (UTC-3) → Date. `null` se malformada. */
export function parseIbgeDate(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface IbgeItem { readonly id: string; readonly tipo: string; readonly titulo: string; readonly introducao: string; readonly data_publicacao: string; readonly link: string; readonly editorias: string; readonly produto_id: string }
export function parseIbge(json: unknown): { items: IbgeItem[]; invalid: number } {
  const list = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(list)) throw new SourceError("parse", "a resposta do IBGE não tem a lista `items`", false);
  const items: IbgeItem[] = [];
  let invalid = 0;
  for (const x of list as Record<string, unknown>[]) {
    if (x && (typeof x.id === "string" || typeof x.id === "number") && typeof x.titulo === "string" && typeof x.link === "string" && typeof x.data_publicacao === "string" && x.titulo.length > 0) {
      items.push({ id: String(x.id), tipo: String(x.tipo ?? ""), titulo: x.titulo, introducao: String(x.introducao ?? ""), data_publicacao: x.data_publicacao, link: x.link, editorias: String(x.editorias ?? ""), produto_id: String(x.produto_id ?? "") });
    } else invalid++;
  }
  return { items, invalid };
}

export function ibgeEvidence(it: IbgeItem, matchedTerms: readonly string[], now: Date): EvidenceDraft | null {
  const published = parseIbgeDate(it.data_publicacao);
  if (!published) return null;
  let url: string;
  try { url = new URL(it.link).toString(); } catch { return null; }
  return {
    adapter: IBGE_ID, kind: "news_item", sourceRef: `${IBGE_ID}:${it.id}`, url, title: it.titulo, summary: excerpt(it.introducao), publishedAt: published, collectedAt: now,
    validUntil: addDays(published, 45), basis: "observed",
    payload: { id: it.id, tipo: it.tipo, editorias: it.editorias, produtoId: it.produto_id, dataPublicacao: it.data_publicacao, matchedTerms: [...matchedTerms].sort() },
    topics: [], limitations: ["Fonte oficial de estatísticas: a notícia registra um dado publicado, não demanda de busca nem tendência de consulta."],
  };
}

export const ibgeNewsAdapter: SourceAdapter = {
  id: IBGE_ID, label: "IBGE: Agência de Notícias", provider: "Instituto Brasileiro de Geografia e Estatística", kind: "news",
  docsUrl: "https://servicodados.ibge.gov.br/api/docs/noticias", terms: "Serviço de dados público do IBGE; sem credencial; citar a fonte.",
  async run(ctx: AdapterContext): Promise<AdapterResult> {
    const started = Date.now();
    const errors: AdapterError[] = [];
    const byId = new Map<string, { item: IbgeItem; terms: Set<string> }>();
    let requests = 0, bytes = 0, seen = 0, stale = 0, irrelevant = 0, invalidTotal = 0;
    const terms = ctx.vertical.sources.ibgeSearchTerms;
    const kw = ctx.vertical.relevanceKeywords.map(fold);
    for (const [i, term] of terms.entries()) {
      if (i > 0) await ctx.sleep(300);
      const url = `${BASE}?busca=${encodeURIComponent(term)}&qtd=${PER_TERM}`;
      try {
        requests++;
        const r = await httpGet(ctx.fetch, url, { userAgent: ctx.userAgent, accept: "application/json" });
        bytes += r.bytes;
        let json: unknown;
        try { json = JSON.parse(r.text); } catch { throw new SourceError("parse", "a resposta do IBGE não é JSON", false); }
        const { items, invalid } = parseIbge(json);
        invalidTotal += invalid; seen += items.length;
        for (const it of items) {
          const published = parseIbgeDate(it.data_publicacao);
          if (!published || ctx.now.getTime() - published.getTime() > MAX_AGE_DAYS * 86_400_000) { stale++; continue; }
          const text = fold(`${it.titulo} ${it.introducao}`);
          if (!kw.some((k) => text.includes(k))) { irrelevant++; continue; }
          const cur = byId.get(it.id) ?? { item: it, terms: new Set<string>() };
          cur.terms.add(term);
          byId.set(it.id, cur);
        }
      } catch (e) {
        const se = e instanceof SourceError ? e : new SourceError("network", "falha inesperada", true);
        errors.push({ target: `busca:${term}`, code: se.code, message: se.message, retryable: se.retryable });
      }
    }
    const evidence = [...byId.values()].flatMap(({ item, terms: t }) => { const e = ibgeEvidence(item, [...t], ctx.now); return e ? [e] : []; }).sort((a, b) => (b.publishedAt!.getTime() - a.publishedAt!.getTime()) || (a.sourceRef < b.sourceRef ? -1 : 1));
    const limitations = [`${stale} notícia(s) com mais de ${MAX_AGE_DAYS} dias ou data ilegível foram ignoradas.`, `${irrelevant} notícia(s) sem relação com as palavras-chave da vertical foram ignoradas.`];
    if (invalidTotal > 0) limitations.push(`${invalidTotal} item(ns) malformado(s) foram descartados.`);
    return finish(IBGE_ID, started, Date.now, { evidence, errors, requests, bytes, seen, kept: evidence.length, limitations, attempted: terms.length });
  },
};
