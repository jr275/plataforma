import "server-only";
import { createAppPool } from "@plataforma/api";

// Pool único do servidor (ADR-018). Credencial `menlo_app` em PLATAFORMA_APP_DATABASE_URL (sem NEXT_PUBLIC_, sensível no Vercel).
// `null` = não configurado: a interface mostra isso explicitamente e NUNCA cai para dados fictícios.
type Pool = ReturnType<typeof createAppPool>;
const globalForPool = globalThis as unknown as { __plataformaPool?: Pool };

export function appPool(): Pool | null {
  const url = process.env.PLATAFORMA_APP_DATABASE_URL?.trim();
  if (!url) return null;
  globalForPool.__plataformaPool ??= createAppPool(url);
  return globalForPool.__plataformaPool;
}
