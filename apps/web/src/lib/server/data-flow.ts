import "server-only";
import { connection } from "next/server";
import { countCities, getImportRun, listImportRecords, listImportRuns, withTenant, type ImportRecordView, type ImportRunSummary } from "@plataforma/api";
import { appPool } from "./db";
import { requestIdentity } from "./identity";

// Dados da tela "Fluxo de dados" (ADR-018). Só funções tipadas de packages/api, sempre por withTenant com o tenant da identidade verificada.
export type DataFlow =
  | { state: "not_configured"; missing: string }
  | { state: "unauthenticated" }
  | { state: "no_tenant" }
  | { state: "error" }
  | { state: "ready"; runs: readonly ImportRunSummary[]; cityCount: number; selected?: { run: ImportRunSummary; records: readonly ImportRecordView[]; truncated: boolean } };

const RECORD_LIMIT = 200;

export async function loadDataFlow(runId?: string): Promise<DataFlow> {
  await connection(); // lê sessão e relógio: só em tempo de requisição, nunca na pré-renderização
  const who = await requestIdentity();
  if (who.state === "not_configured") return { state: "not_configured", missing: "login (Supabase)" };
  if (who.state === "unauthenticated") return { state: "unauthenticated" };
  const pool = appPool();
  if (!pool) return { state: "not_configured", missing: "banco de dados (PLATAFORMA_APP_DATABASE_URL)" };
  const tenantId = who.identity.tenantIds[0];
  if (!tenantId) return { state: "no_tenant" };
  try {
    return await withTenant(pool, who.identity, tenantId, async (db) => {
      const [runs, cityCount] = await Promise.all([listImportRuns(db, { limit: 50 }), countCities(db)]);
      let selected: Extract<DataFlow, { state: "ready" }>["selected"];
      if (runId) {
        const run = await getImportRun(db, runId);
        if (run) {
          const records = await listImportRecords(db, run.id, { limit: RECORD_LIMIT + 1 });
          selected = { run, records: records.slice(0, RECORD_LIMIT), truncated: records.length > RECORD_LIMIT };
        }
      }
      return { state: "ready" as const, runs, cityCount, selected };
    });
  } catch {
    return { state: "error" }; // nunca devolve a mensagem do banco (pode conter host ou usuário)
  }
}
