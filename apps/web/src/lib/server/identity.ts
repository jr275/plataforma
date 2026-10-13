import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { AuthenticationError, createSupabaseAuthenticator, supabaseJwks, type VerifiedIdentity } from "@plataforma/api";
import { supabaseConfig } from "@/lib/supabase/config";

// Identidade da requisição (ADR-015/018): o token de acesso sai do cookie de sessão e é VERIFICADO no servidor (assinatura via JWKS,
// emissor, audiência, expiração). O tenant vem só da claim assinada `app_metadata.tenant_ids`.
export type IdentityResult =
  | { state: "ok"; identity: VerifiedIdentity }
  | { state: "not_configured" }
  | { state: "unauthenticated" };

export async function requestIdentity(): Promise<IdentityResult> {
  const config = supabaseConfig();
  if (!config) return { state: "not_configured" };
  const store = await cookies();
  const supabase = createServerClient(config.url, config.key, { cookies: { getAll: () => store.getAll(), setAll: () => undefined } });
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { state: "unauthenticated" };
  const issuer = `${config.url.replace(/\/+$/, "")}/auth/v1`;
  try {
    const identity = await createSupabaseAuthenticator({ issuer, key: supabaseJwks(issuer), algorithms: ["ES256", "RS256"] }).authenticate(token);
    return { state: "ok", identity };
  } catch (e) {
    if (e instanceof AuthenticationError) return { state: "unauthenticated" };
    throw e;
  }
}
