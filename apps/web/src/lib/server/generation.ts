import "server-only";
import { UFS, getGenerationRunDetail, getPageDetail, listGenerationRuns, searchPages, type PageSearch } from "@plataforma/api";
import { loadForTenant } from "./tenant-data";

// Dados da área "Geração de páginas" (ADR-018/020). Só funções tipadas de packages/api.
export const PAGE_SIZE = 20;
const STATUSES = ["draft", "blocked"] as const;
const SORTS = ["path", "updated", "population"] as const;

export interface HomeParams { q: string; status: "" | (typeof STATUSES)[number]; uf: string; sort: (typeof SORTS)[number]; dir: "asc" | "desc"; page: number }

/** Lê os parâmetros da URL de forma defensiva: qualquer valor fora da lista volta ao padrão (nada vai cru para o banco). */
export function parseHomeParams(raw: Record<string, string | string[] | undefined>): HomeParams {
  const one = (k: string) => { const v = raw[k]; return typeof v === "string" ? v : ""; };
  const status = one("status");
  const uf = one("uf").toUpperCase();
  const sort = one("sort");
  const page = Number.parseInt(one("page"), 10);
  return {
    q: one("q").trim().slice(0, 80),
    status: (STATUSES as readonly string[]).includes(status) ? (status as HomeParams["status"]) : "",
    uf: (UFS as readonly string[]).includes(uf) ? uf : "",
    sort: (SORTS as readonly string[]).includes(sort) ? (sort as HomeParams["sort"]) : "path",
    dir: one("dir") === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/**
 * `?v=` do detalhe da página. Contrato: ausente (ou vazio) = a mais recente, sem aviso; inteiro positivo em decimal simples (1 a 999999999)
 * = a versão pedida; QUALQUER outro valor presente é inválido (a tela avisa e mostra a mais recente, em vez de adivinhar uma versão).
 */
export type VersionParam = { kind: "none" } | { kind: "ok"; version: number } | { kind: "invalid" };
export function parseVersionParam(raw: string | string[] | undefined): VersionParam {
  if (raw === undefined || raw === "") return { kind: "none" };
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,8}$/.test(raw)) return { kind: "invalid" };
  return { kind: "ok", version: Number(raw) };
}

export function loadGenerationHome(p: HomeParams) {
  const search: PageSearch = { q: p.q || undefined, status: p.status || undefined, uf: p.uf || undefined, sort: p.sort, dir: p.dir, limit: PAGE_SIZE, offset: (p.page - 1) * PAGE_SIZE };
  return loadForTenant(async (db) => {
    const [pages, runs, drafts, blocked] = await Promise.all([
      searchPages(db, search),
      listGenerationRuns(db, { limit: 8 }),
      searchPages(db, { status: "draft", limit: 1 }),
      searchPages(db, { status: "blocked", limit: 1 }),
    ]);
    return { pages, runs, drafts: drafts.total, blocked: blocked.total, now: new Date() };
  });
}

export const loadPageDetail = (id: string) => loadForTenant(async (db) => ({ detail: await getPageDetail(db, id), now: new Date() }));
export const loadRunDetail = (id: string) => loadForTenant((db) => getGenerationRunDetail(db, id));
