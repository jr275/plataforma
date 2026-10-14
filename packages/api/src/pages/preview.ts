import type { TenantDb } from "../tenant-context";
import { getCityDetail, type CitySource } from "../ingest/city-search";
import { CITY_OVERVIEW, type RenderedPage } from "./city-overview";
import { evaluateCity, type GateResult } from "./gates";

// Prévia da experiência (ADR-024): renderiza AGORA, com o motor real de páginas e os fatos reais da cidade, a página que o template geraria. Não grava nada e NÃO é publicação.
export interface CityPreview { readonly outcome: "generated" | "unchanged" | "blocked"; readonly gates: readonly GateResult[]; readonly page: RenderedPage | null; readonly source: CitySource }
export async function previewCityPage(db: TenantDb, cityId: string): Promise<CityPreview | null> {
  const d = await getCityDetail(db, cityId);
  if (!d) return null;
  const pages = await db.query<{ path: string; entity_id: string }>(`SELECT path, entity_id FROM plataforma.page`);
  const pathOwners = new Map(pages.rows.map((p) => [p.path, p.entity_id]));
  const ev = evaluateCity(d.city, { id: d.source.runId, sourceName: d.source.sourceName, origin: d.source.origin, status: d.source.status, fileSha256: d.source.fileSha256, finishedAt: d.source.finishedAt },
    { template: CITY_OVERVIEW, knownPaths: new Set(pages.rows.map((p) => p.path)), pathOwners, titleOwners: new Map(), metaOwners: new Map(), existingByEntity: new Map() });
  return { outcome: ev.outcome, gates: ev.gates, page: ev.page ?? null, source: d.source };
}
