import { SourceError, httpGet, type FetchLike } from "./http";

// robots.txt (RFC 9309): grupo mais específico para o nosso agente, senão "*"; regra mais longa vence; Allow vence empate; `*` e `$` nos caminhos.
export interface RobotsRule { readonly allow: boolean; readonly path: string }
export interface RobotsGroup { readonly agents: readonly string[]; readonly rules: readonly RobotsRule[]; readonly crawlDelay: number | null }
export interface Robots { readonly groups: readonly RobotsGroup[] }

export function parseRobots(text: string): Robots {
  const groups: { agents: string[]; rules: RobotsRule[]; crawlDelay: number | null }[] = [];
  let cur: { agents: string[]; rules: RobotsRule[]; crawlDelay: number | null } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [], crawlDelay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" || key === "disallow") { if (val !== "" || key === "allow") cur.rules.push({ allow: key === "allow", path: val }); }
    else if (key === "crawl-delay") { const n = Number(val); if (Number.isFinite(n) && n >= 0) cur.crawlDelay = n; }
  }
  return { groups };
}

const compile = (path: string): RegExp => new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
const specificity = (p: string) => p.replace(/\*/g, "").length;

function groupFor(r: Robots, agent: string): RobotsGroup | undefined {
  const a = agent.toLowerCase().split("/")[0]!;
  const specific = r.groups.filter((g) => g.agents.some((x) => x !== "*" && a.includes(x)));
  return specific[0] ?? r.groups.find((g) => g.agents.includes("*"));
}
export function isAllowed(r: Robots, agent: string, pathAndQuery: string): boolean {
  const g = groupFor(r, agent);
  if (!g) return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const rule of g.rules) {
    if (rule.path === "" ) continue;
    if (!compile(rule.path).test(pathAndQuery)) continue;
    const len = specificity(rule.path);
    if (!best || len > best.len || (len === best.len && rule.allow && !best.allow)) best = { allow: rule.allow, len };
  }
  return best ? best.allow : true;
}
export const crawlDelayOf = (r: Robots, agent: string): number | null => groupFor(r, agent)?.crawlDelay ?? null;

export interface RobotsCheck { readonly allowed: boolean; readonly crawlDelaySeconds: number | null; readonly reason: string }
/**
 * Consulta o robots.txt do host da URL. 404/410 = sem restrições; 5xx, timeout ou falha de rede = NÃO permitido (RFC 9309: indisponível = proibido).
 * O resultado é guardado em `cache` por host durante a execução.
 */
export async function checkRobots(fetchFn: FetchLike, url: string, userAgent: string, cache: Map<string, Promise<Robots | "missing" | "unavailable">> = new Map()): Promise<RobotsCheck> {
  const u = new URL(url);
  const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
  let p = cache.get(u.host);
  if (!p) {
    p = httpGet(fetchFn, robotsUrl, { userAgent, accept: "text/plain", maxBytes: 500_000 }).then((r) => parseRobots(r.text), (e: unknown) => (e instanceof SourceError && e.code === "http" && e.status !== undefined && e.status >= 400 && e.status < 500 ? "missing" as const : "unavailable" as const));
    cache.set(u.host, p);
  }
  const r = await p;
  if (r === "missing") return { allowed: true, crawlDelaySeconds: null, reason: "o host não publica robots.txt (404): sem restrições declaradas" };
  if (r === "unavailable") return { allowed: false, crawlDelaySeconds: null, reason: "robots.txt indisponível: por precaução (RFC 9309) a coleta não é feita" };
  const path = u.pathname + u.search;
  const allowed = isAllowed(r, userAgent, path);
  return { allowed, crawlDelaySeconds: crawlDelayOf(r, userAgent), reason: allowed ? "permitido pelo robots.txt" : `o robots.txt do host proíbe ${path}` };
}
