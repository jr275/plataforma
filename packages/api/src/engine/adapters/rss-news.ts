import { addDays, decodeEntities, excerpt, type EvidenceDraft } from "../evidence";
import { SourceError, httpGet } from "../http";
import { fold } from "../normalize";
import { checkRobots } from "../robots";
import { finish, type AdapterContext, type AdapterError, type AdapterResult, type SourceAdapter } from "./types";

// Feeds RSS públicos de notícias. Antes de cada feed: robots.txt do host (RFC 9309) e o Crawl-delay declarado. Guarda só título, link, data e um trecho curto
// (com atribuição); nunca o texto integral. Nenhum conteúdo é reescrito.
export const RSS_ID = "rss-news";
export const MAX_AGE_DAYS = 30;
export const MAX_WAIT_MS = 12_000;

export interface RssItem { readonly title: string; readonly link: string; readonly guid: string | null; readonly pubDate: string | null; readonly description: string; readonly creator: string | null; readonly categories: readonly string[] }
const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  if (!m) return null;
  const v = m[1]!.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v);
  return cdata ? cdata[1]!.trim() : decodeEntities(v);
};
const tags = (xml: string, name: string): string[] => [...xml.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => { const v = m[1]!.trim(); const c = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(v); return c ? c[1]!.trim() : decodeEntities(v); });

export function parseRss(xml: string): { items: RssItem[]; invalid: number } {
  if (!/<rss[\s>]/i.test(xml) && !/<channel[\s>]/i.test(xml)) throw new SourceError("parse", "o conteúdo não é um feed RSS", false);
  const blocks = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const items: RssItem[] = [];
  let invalid = 0;
  for (const b of blocks) {
    const title = tag(b, "title"), link = tag(b, "link");
    if (!title || !link) { invalid++; continue; }
    items.push({ title, link, guid: tag(b, "guid"), pubDate: tag(b, "pubDate"), description: tag(b, "description") ?? "", creator: tag(b, "dc:creator"), categories: tags(b, "category") });
  }
  return { items, invalid };
}

export function rssEvidence(feed: { id: string; label: string }, it: RssItem, now: Date): EvidenceDraft | null {
  let url: string;
  try { url = new URL(it.link).toString(); } catch { return null; }
  const published = it.pubDate ? new Date(it.pubDate) : null;
  const ok = published !== null && !Number.isNaN(published.getTime());
  return {
    adapter: RSS_ID, kind: "news_item", sourceRef: `${RSS_ID}:${feed.id}:${it.guid ?? url}`, url, title: it.title, summary: excerpt(it.description), publishedAt: ok ? published : null, collectedAt: now,
    validUntil: ok ? addDays(published!, 30) : addDays(now, 14), basis: "observed",
    payload: { feed: feed.id, feedLabel: feed.label, guid: it.guid, creator: it.creator, categories: it.categories, pubDateRaw: it.pubDate, attribution: `${feed.label}${it.creator ? `, ${it.creator}` : ""}` },
    topics: [], limitations: ["Trecho curto de uma notícia de terceiros, com atribuição; o texto integral não é guardado.", "Uma notícia não mede demanda de busca nem prova uma tendência de consulta."],
  };
}

export const rssNewsAdapter: SourceAdapter = {
  id: RSS_ID, label: "Notícias por RSS público", provider: "Feeds RSS públicos (ex.: Agência Brasil)", kind: "news",
  docsUrl: "https://www.rssboard.org/rss-specification", terms: "Respeita robots.txt e Crawl-delay; guarda só título, link, data e trecho curto com atribuição; conteúdo é de terceiros.",
  async run(ctx: AdapterContext): Promise<AdapterResult> {
    const started = Date.now();
    const errors: AdapterError[] = [], evidence: EvidenceDraft[] = [];
    let requests = 0, bytes = 0, seen = 0, stale = 0, irrelevant = 0, invalidTotal = 0;
    const kw = ctx.vertical.relevanceKeywords.map(fold);
    const feeds = ctx.vertical.sources.rssFeeds;
    for (const feed of feeds) {
      try {
        requests++; // o robots.txt conta como requisição
        const robots = await checkRobots(ctx.fetch, feed.url, ctx.userAgent, ctx.robots);
        if (!robots.allowed) throw new SourceError(robots.reason.startsWith("robots.txt indisponível") ? "robots_unavailable" : "robots_denied", robots.reason, robots.reason.startsWith("robots.txt indisponível"));
        if (robots.crawlDelaySeconds && robots.crawlDelaySeconds > 0) await ctx.sleep(Math.min(robots.crawlDelaySeconds * 1000, MAX_WAIT_MS));
        requests++;
        const r = await httpGet(ctx.fetch, feed.url, { userAgent: ctx.userAgent, accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8" });
        bytes += r.bytes;
        const { items, invalid } = parseRss(r.text);
        invalidTotal += invalid; seen += items.length;
        for (const it of items) {
          const e = rssEvidence(feed, it, ctx.now);
          if (!e) { invalidTotal++; continue; }
          if (e.publishedAt && ctx.now.getTime() - e.publishedAt.getTime() > MAX_AGE_DAYS * 86_400_000) { stale++; continue; }
          const text = fold(`${it.title} ${excerpt(it.description, 600)} ${it.categories.join(" ")}`);
          if (!kw.some((k) => text.includes(k))) { irrelevant++; continue; }
          evidence.push(e);
        }
      } catch (e) {
        const se = e instanceof SourceError ? e : new SourceError("network", "falha inesperada", true);
        errors.push({ target: feed.id, code: se.code, message: se.message, retryable: se.retryable });
      }
    }
    const limitations = [`${stale} item(ns) com mais de ${MAX_AGE_DAYS} dias foram ignorados.`, `${irrelevant} item(ns) sem relação com as palavras-chave da vertical foram ignorados.`];
    if (invalidTotal > 0) limitations.push(`${invalidTotal} item(ns) malformado(s) foram descartados.`);
    return finish(RSS_ID, started, Date.now, { evidence, errors, requests, bytes, seen, kept: evidence.length, limitations, attempted: feeds.length });
  },
};
