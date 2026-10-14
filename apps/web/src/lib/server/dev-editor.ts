import "server-only";
import { createAppPool, devIdentity } from "@plataforma/api";
import type { EditorCtx } from "./draft-service";

// BANCADA do editor (ADR-026), SOMENTE desenvolvimento: usa um banco descartável indicado por PLATAFORMA_DEV_EDITOR_DATABASE_URL e um tenant fixo, sem login. Nunca funciona em
// produção (NODE_ENV) nem sem as DUAS variáveis; não toca o banco do aplicativo. O código que grava é o MESMO de produção (RLS, versões, validação).
type Pool = ReturnType<typeof createAppPool>;
const g = globalThis as unknown as { __devEditorPool?: Pool };
export function devEditorContext(): EditorCtx | null {
  if (process.env.NODE_ENV === "production") return null;
  const url = process.env.PLATAFORMA_DEV_EDITOR_DATABASE_URL?.trim(); const tenant = process.env.PLATAFORMA_DEV_EDITOR_TENANT?.trim();
  if (!url || !tenant || !/^[0-9a-f-]{36}$/i.test(tenant)) return null;
  g.__devEditorPool ??= createAppPool(url, { max: 3 });
  return { pool: g.__devEditorPool, identity: devIdentity([tenant]), tenantId: tenant };
}
