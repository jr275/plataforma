import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type CryptoKey, type JWTVerifyGetKey, type JWTVerifyOptions } from "jose";
import { AuthenticationError, type AuthFailureReason } from "../errors";
import { verifiedIdentity, type VerifiedIdentity } from "../identity";
import { parseTenantId } from "../tenant-id";

// Autenticador do Supabase (ADR-015, opção A). ÚNICO ponto, junto de dev-identity.ts, que cria uma VerifiedIdentity (o teste estático
// impõe). Verifica o token de acesso NO SERVIDOR: assinatura com algoritmo fixado pela configuração (nunca o que o token declara),
// emissor, audiência, expiração e a claim de papel. A lista de tenants vem da claim assinada `app_metadata.tenant_ids`, que só o
// administrador escreve (chave de serviço, fora do runtime). LIMITE: uma revogação só vale quando o token expira.
// Este módulo não lê variáveis de ambiente, não faz login e não guarda segredo: a configuração é entregue por quem o chama.

export type SupportedAlgorithm = "ES256" | "ES384" | "RS256" | "RS384" | "RS512" | "PS256" | "EdDSA" | "HS256";

export interface SupabaseAuthConfig {
  /** Emissor exato do token (no Supabase: `https://<projeto>.supabase.co/auth/v1`). */
  readonly issuer: string;
  /** Audiência esperada. Padrão: `authenticated`. */
  readonly audience?: string;
  /** Chave pública, segredo compartilhado (HS256) ou resolvedor de chaves (por exemplo `supabaseJwks`). */
  readonly key: CryptoKey | Uint8Array | JWTVerifyGetKey;
  /** Algoritmos aceitos, fixados aqui. `none` nunca é aceito. */
  readonly algorithms: readonly [SupportedAlgorithm, ...SupportedAlgorithm[]];
  /** Tolerância de relógio em segundos (0 a 60). Padrão: 0. */
  readonly clockToleranceSeconds?: number;
  /** Tamanho máximo do token, em bytes. Padrão: 8192. */
  readonly maxTokenBytes?: number;
}

export interface SupabaseAuthenticator {
  authenticate(token: unknown): Promise<VerifiedIdentity>;
}

const MAX_TENANTS = 100;
const MAX_SUB = 128;

/** Resolvedor das chaves públicas do projeto (JWKS), com cache do `jose`. Só rede quando usado; nada roda ao importar. */
export function supabaseJwks(issuer: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(`${issuer.replace(/\/+$/, "")}/.well-known/jwks.json`));
}

/** Extrai o token de um cabeçalho `Authorization: Bearer <token>`. */
export function bearerToken(header: string | null | undefined): string {
  const match = typeof header === "string" ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
  if (!match) throw new AuthenticationError("malformed");
  return match[1]!;
}

function classify(error: unknown): AuthFailureReason {
  if (error instanceof joseErrors.JWTExpired) return "expired";
  if (error instanceof joseErrors.JWTClaimValidationFailed) return error.claim === "nbf" ? "not_yet_valid" : "claims";
  if (error instanceof joseErrors.JWSInvalid || error instanceof joseErrors.JWTInvalid) return "malformed";
  if (error instanceof joseErrors.JOSEError) {
    // Falha de rede ou de tempo ao buscar as chaves não é culpa do token: a disponibilidade é outra categoria.
    return error instanceof joseErrors.JWKSTimeout ? "key_unavailable" : "signature";
  }
  return "key_unavailable";
}

export function createSupabaseAuthenticator(config: SupabaseAuthConfig): SupabaseAuthenticator {
  if (typeof config.issuer !== "string" || config.issuer.length === 0) throw new TypeError("issuer é obrigatório");
  if (config.algorithms.length === 0 || config.algorithms.some((a) => (a as string) === "none")) throw new TypeError("algorithms precisa listar algoritmos de assinatura reais");
  const tolerance = config.clockToleranceSeconds ?? 0;
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 60) throw new TypeError("clockToleranceSeconds precisa ser inteiro de 0 a 60");
  const maxBytes = config.maxTokenBytes ?? 8192;
  const options: JWTVerifyOptions = {
    issuer: config.issuer,
    audience: config.audience ?? "authenticated",
    algorithms: [...config.algorithms],
    clockTolerance: tolerance,
    requiredClaims: ["sub", "exp"],
  };

  return Object.freeze({
    async authenticate(token: unknown): Promise<VerifiedIdentity> {
      if (typeof token !== "string" || token.length === 0 || token.length > maxBytes) throw new AuthenticationError("malformed");
      let payload: Record<string, unknown>;
      try {
        const verified = typeof config.key === "function" ? await jwtVerify(token, config.key, options) : await jwtVerify(token, config.key, options);
        payload = verified.payload as Record<string, unknown>;
      } catch (error) {
        throw new AuthenticationError(classify(error), { cause: error });
      }
      const sub = payload.sub;
      if (typeof sub !== "string" || sub.length === 0 || sub.length > MAX_SUB) throw new AuthenticationError("claims");
      if (payload.role !== "authenticated") throw new AuthenticationError("claims"); // recusa, por exemplo, o token anônimo
      return verifiedIdentity({ userId: sub, tenantIds: readTenantIds(payload.app_metadata) });
    },
  });
}

/** `app_metadata.tenant_ids`: ausente = nenhum tenant; qualquer formato inválido recusa o token inteiro (nada é "consertado"). */
function readTenantIds(appMetadata: unknown): string[] {
  if (appMetadata === undefined) return [];
  if (typeof appMetadata !== "object" || appMetadata === null || Array.isArray(appMetadata)) throw new AuthenticationError("tenant_claim");
  const raw = (appMetadata as Record<string, unknown>).tenant_ids;
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_TENANTS) throw new AuthenticationError("tenant_claim");
  try {
    return raw.map((t) => {
      if (typeof t !== "string") throw new TypeError("tenant não é texto");
      return parseTenantId(t);
    });
  } catch (cause) {
    throw new AuthenticationError("tenant_claim", { cause });
  }
}
