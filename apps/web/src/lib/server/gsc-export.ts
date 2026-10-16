import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseGscExportSnapshot, type GscExportSnapshot } from "@plataforma/api";
import { integrationAccess } from "./gsc";

// Relatórios a partir do export do Search Console (ADR-026). O snapshot é um arquivo local agregado, FORA do Git; em produção ele não
// existe e a tela diz isso. Mesma regra de acesso das integrações: sessão com tenant, ou desenvolvimento local fora de produção.
export type GscExportLoaded =
  | { state: "ready"; snapshot: GscExportSnapshot }
  | { state: "not_loaded" }
  | { state: "invalid" }
  | { state: "other_tenant" }
  | { state: "denied"; reason: "unauthenticated" | "no_tenant" | "login_not_configured" };

export const GSC_EXPORT_FILE = join(process.cwd(), ".data", "gsc-export.json");

export async function loadGscExport(): Promise<GscExportLoaded> {
  const access = await integrationAccess();
  if (!access.ok) return { state: "denied", reason: access.reason };
  let raw: string;
  try { raw = await readFile(process.env.GSC_EXPORT_FILE ?? GSC_EXPORT_FILE, "utf8"); } catch { return { state: "not_loaded" }; }
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { state: "invalid" }; }
  const snapshot = parseGscExportSnapshot(json);
  if (!snapshot) return { state: "invalid" };
  // O arquivo é de um tenant: com sessão, só quem pertence a ele vê. Sem sessão (desenvolvimento local), aparece.
  if (access.mode === "session" && snapshot.tenantId !== access.tenantId) return { state: "other_tenant" };
  return { state: "ready", snapshot };
}
