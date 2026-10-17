import "server-only";
import { connection } from "next/server";
import { STAGE_IDS, TOOLS, computeMetrics, evaluateAll, listGenerationRuns, listImportRuns, withTenant, type OperationalEvidence as Evidence, type OperationalMetrics, type ToolInput, type ToolState } from "@plataforma/api";
import { buildOperationsFlow, buildToolRows, type ToolRow } from "@/lib/ops/operations-flow";
import { importMode, runEvidence } from "@/lib/ops/evidence";
import { loadGscExport } from "./gsc-export";
import { integrationAccess, type IntegrationAccess } from "./gsc";
import { isNotMigrated, resolveTenantContext } from "./tenant-data";
import type { FlowDefinition } from "@/lib/flow/model";

// Console de operações. O status vem do REGISTRO e de EVIDÊNCIA coletada agora: presença de configuração (só nomes), uma sondagem do banco
// feita nesta requisição, registros reais de importação e de geração, e o snapshot do Search Console. Não há tabela própria de execuções
// (precisa de migration, ainda não autorizada), então o que não deixa registro persistido aparece como NÃO TESTADO.

export type OperationsData =
  | { state: "denied"; reason: Extract<IntegrationAccess, { ok: false }>["reason"] }
  | { state: "ready"; generatedAt: string; flow: FlowDefinition; rows: ToolRow[]; metrics: OperationalMetrics; running: boolean; evidenceSources: string[] };

export async function loadOperations(): Promise<OperationsData> {
  await connection();
  const access = await integrationAccess();
  if (!access.ok) return { state: "denied", reason: access.reason };
  const now = new Date();
  const sources: string[] = ["configuração do ambiente (só presença de nomes)"];

  const names = [...new Set(TOOLS.flatMap((t) => t.requiresConfig))];
  const configPresent = new Set(names.filter((n) => (process.env[n] ?? "").trim() !== ""));
  const ev: Record<string, Evidence[]> = {};
  const add = (id: string, e: Evidence | Evidence[]) => { (ev[id] ??= []).push(...(Array.isArray(e) ? e : [e])); };
  let running = false;

  const ctx = await resolveTenantContext();
  if (ctx.ok) {
    add("platform.identity", { id: `sessao:${now.getTime()}`, kind: "live_check", mode: "live", at: now.toISOString(), outcome: "success", detail: "sessão verificada com workspace" });
    sources.push("sessão verificada");
    try {
      const result = await withTenant(ctx.pool, ctx.identity, ctx.tenantId, async (db) => {
        await db.query("SELECT 1");
        add("platform.database", { id: `sonda:${now.getTime()}`, kind: "live_check", mode: "live", at: new Date().toISOString(), outcome: "success", detail: "consulta de sondagem por papel restrito" });
        try {
          const [imports, gens] = await Promise.all([listImportRuns(db, { limit: 5 }), listGenerationRuns(db, { limit: 8 })]);
          return { imports, gens };
        } catch (e) {
          return { error: isNotMigrated(e) ? "NOT_MIGRATED" : "RUN_QUERY_FAILED" };
        }
      });
      sources.push("sondagem do banco");
      if ("error" in result) {
        const f: Evidence = { id: `leitura:${now.getTime()}`, kind: "live_check", mode: "live", at: now.toISOString(), outcome: "failure", errorCode: result.error, detail: result.error === "NOT_MIGRATED" ? "tabelas de execução ainda não existem neste banco" : "falha ao ler os registros de execução" };
        for (const id of ["ingest.city-import", "generate.city-pages", "quality.gates"]) add(id, f);
      } else {
        add("ingest.city-import", runEvidence("import", result.imports, (r) => importMode(result.imports.find((x) => x.id === r.id)!.origin)));
        add("generate.city-pages", runEvidence("run", result.gens));
        add("quality.gates", runEvidence("gates", result.gens));
        running = result.gens.some((g) => g.status === "running");
        sources.push("registros de importação e de geração");
      }
    } catch {
      add("platform.database", { id: `sonda:${now.getTime()}`, kind: "live_check", mode: "live", at: now.toISOString(), outcome: "failure", errorCode: "DB_UNREACHABLE", detail: "a consulta de sondagem falhou" });
    }
  } else if (ctx.reason === "no_tenant") {
    add("platform.identity", { id: `sessao:${now.getTime()}`, kind: "live_check", mode: "live", at: now.toISOString(), outcome: "partial", detail: "sessão válida, mas sem workspace na claim" });
  }

  const gsc = await loadGscExport();
  if (gsc.state === "ready") { add("measure.gsc-export", { id: `snapshot:${gsc.snapshot.exportedAt}`, kind: "import_snapshot", mode: "import", at: `${gsc.snapshot.exportedAt}T00:00:00Z`, outcome: "success" }); sources.push("snapshot do Search Console"); }
  else if (gsc.state === "invalid") add("measure.gsc-export", { id: "snapshot:invalido", kind: "import_snapshot", mode: "import", at: now.toISOString(), outcome: "failure", errorCode: "INVALID_SNAPSHOT", detail: "o arquivo do export não tem o formato esperado" });

  const inputs = new Map<string, ToolInput>(TOOLS.map((t) => [t.id, { configPresent, evidence: ev[t.id] ?? [] }]));
  const states: Map<string, ToolState> = evaluateAll(TOOLS, inputs, now);
  return { state: "ready", generatedAt: now.toISOString(), flow: buildOperationsFlow(states, { running }), rows: buildToolRows(states), metrics: computeMetrics(TOOLS, STAGE_IDS, states, inputs), running, evidenceSources: sources };
}
