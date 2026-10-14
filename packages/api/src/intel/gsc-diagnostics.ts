import { readFileSync } from "node:fs";
import { GSC_SCOPE, serviceAccountSchema, signAssertion, type ServiceAccount } from "./gsc";
import type { ProviderResult } from "./provider-status";

// Diagnóstico e validação da conexão com o Google Search Console.
// Regras: nada aqui devolve segredo (chave, JSON decodificado, token, corpo cru do Google). O que sai é um código estável,
// um texto explicativo nosso e, no máximo, um "reason" do Google que esteja na lista permitida. A validação é só leitura.

export const GSC_STATUSES = [
  "not_configured",
  "invalid_credentials",
  "invalid_property",
  "api_not_enabled_or_unavailable",
  "permission_denied",
  "provider_error",
  "connected",
  "connected_no_data",
  "validation_running",
  /** Configuração local válida, mas nenhuma chamada ao Google comprovou a conexão ainda. Nunca é "connected". */
  "configured_not_validated",
] as const;
export type GscStatus = (typeof GSC_STATUSES)[number];

export const GSC_CHECKS = ["credentials_configured", "credential_format", "authentication", "api_access", "property_access", "search_analytics"] as const;
export type GscCheckId = (typeof GSC_CHECKS)[number];
export type GscCheckState = "passed" | "failed" | "pending" | "not_checked";

export type GscErrorCode =
  | "credentials_missing"
  | "site_url_missing"
  | "credential_file_unreadable"
  | "credential_raw_json"
  | "credential_not_base64"
  | "credential_not_json"
  | "credential_oauth_client"
  | "credential_missing_fields"
  | "property_invalid"
  | "auth_failed"
  | "api_disabled"
  | "api_unavailable"
  | "permission_denied"
  | "property_not_found"
  | "property_unverified"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "unexpected_response"
  | "upstream_error";

export type PropertyKind = "domain" | "url_prefix";
export interface GscProperty { readonly value: string; readonly kind: PropertyKind }

/** Identidade segura de exibir: o e-mail da service account é o que o operador precisa para dar acesso no Search Console. */
export interface GscIdentity { readonly clientEmail: string; readonly projectId: string | null }

export interface GscCheck { readonly id: GscCheckId; readonly state: GscCheckState; readonly detail?: string }

export interface Remediation {
  readonly what: string;
  readonly why: string;
  readonly change: string;
  readonly where: string;
  readonly actor: "operador da plataforma" | "administrador do Google Cloud" | "proprietário da propriedade no Search Console" | "nenhum (aguardar)";
  readonly external: boolean;
}

export interface GscError { readonly code: GscErrorCode; readonly httpStatus?: number; readonly upstreamReason?: string }

export interface GscValidationResult {
  readonly status: GscStatus;
  readonly mode: "configuration" | "live";
  readonly property: GscProperty | null;
  readonly identity: GscIdentity | null;
  readonly checks: readonly GscCheck[];
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly rowsReturned: number | null;
  readonly dateRange: { readonly startDate: string; readonly endDate: string } | null;
  readonly error: GscError | null;
  readonly explanation: string;
  readonly remediation: Remediation | null;
}

// ---------------------------------------------------------------- propriedade

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type PropertyParse = { readonly ok: true; readonly property: GscProperty } | { readonly ok: false; readonly reason: string };

/** Valida sem trocar um tipo de propriedade pelo outro: `sc-domain:` e prefixo de URL são propriedades diferentes no Google. */
export function parseGscProperty(raw: string | undefined): PropertyParse {
  const value = raw?.trim() ?? "";
  if (!value) return { ok: false, reason: "GSC_SITE_URL está vazia." };
  if (value.toLowerCase().startsWith("sc-domain:")) {
    const host = value.slice("sc-domain:".length);
    if (!DOMAIN_RE.test(host)) return { ok: false, reason: "Propriedade de domínio deve ser só o domínio, em minúsculas, sem protocolo nem caminho (ex.: sc-domain:exemplo.com.br)." };
    return { ok: true, property: { value: `sc-domain:${host}`, kind: "domain" } };
  }
  let url: URL;
  try { url = new URL(value); } catch { return { ok: false, reason: "Use sc-domain:<domínio> ou uma URL completa iniciando com https:// (ou http://)." }; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Prefixo de URL precisa usar http:// ou https://." };
  if (url.search || url.hash || url.username || url.password) return { ok: false, reason: "Prefixo de URL não pode ter query, fragmento ou credenciais." };
  if (!value.endsWith("/")) return { ok: false, reason: "Prefixo de URL deve terminar com \"/\", exatamente como aparece no Search Console." };
  return { ok: true, property: { value, kind: "url_prefix" } };
}

// ---------------------------------------------------------------- credencial

export type CredentialParse =
  | { readonly ok: true; readonly account: ServiceAccount; readonly identity: GscIdentity; readonly source: "file" | "env_base64" }
  | { readonly ok: false; readonly code: GscErrorCode; readonly detail: string; readonly missingFields?: readonly string[] };

const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

function decodeBase64Strict(input: string): string | null {
  const compact = input.replace(/\s+/g, "");
  if (!compact || !BASE64_RE.test(compact)) return null;
  const normalized = compact.replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(normalized, "base64");
  if (buf.length === 0) return null;
  if (buf.toString("base64").replace(/=+$/, "") !== normalized.replace(/=+$/, "")) return null;
  return buf.toString("utf8");
}

function credentialFromJson(json: unknown, source: "file" | "env_base64"): CredentialParse {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, code: "credential_not_json", detail: "O conteúdo decodificado não é um objeto JSON." };
  }
  const obj = json as Record<string, unknown>;
  if ("installed" in obj || "web" in obj) {
    return { ok: false, code: "credential_oauth_client", detail: `É um cliente OAuth (${"installed" in obj ? "app para computador" : "aplicativo web"}), não uma service account. Ele exige login interativo e não serve para o servidor.` };
  }
  const parsed = serviceAccountSchema.safeParse(obj);
  if (!parsed.success) {
    const missing = ["type", "client_email", "private_key"].filter((k) => {
      if (k === "type") return obj.type !== "service_account";
      return typeof obj[k] !== "string" || !(obj[k] as string).trim();
    });
    return { ok: false, code: "credential_missing_fields", detail: missing.length ? `Campos ausentes ou inválidos: ${missing.join(", ")}.` : "Campos da service account inválidos.", missingFields: missing };
  }
  const projectId = typeof obj.project_id === "string" ? obj.project_id : null;
  return { ok: true, account: parsed.data, identity: { clientEmail: parsed.data.client_email, projectId }, source };
}

export function parseGscCredential(
  env: Readonly<Record<string, string | undefined>>,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): CredentialParse | null {
  const file = env.GSC_CREDENTIALS_FILE?.trim();
  if (file) {
    let raw: string;
    try { raw = readFile(file); } catch { return { ok: false, code: "credential_file_unreadable", detail: "GSC_CREDENTIALS_FILE aponta para um arquivo que não pôde ser lido." }; }
    try { return credentialFromJson(JSON.parse(raw), "file"); } catch { return { ok: false, code: "credential_not_json", detail: "O arquivo de credencial não é JSON válido." }; }
  }
  const encoded = env.GSC_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (!encoded) return null;
  if (encoded.startsWith("{")) {
    return { ok: false, code: "credential_raw_json", detail: "A variável contém JSON cru; ela precisa do JSON codificado em base64." };
  }
  const decoded = decodeBase64Strict(encoded);
  if (decoded === null) return { ok: false, code: "credential_not_base64", detail: "A variável não é base64 válido." };
  try { return credentialFromJson(JSON.parse(decoded), "env_base64"); } catch { return { ok: false, code: "credential_not_json", detail: "O base64 decodifica, mas o resultado não é JSON válido." }; }
}

// ---------------------------------------------------------------- remediação

const REMEDIATIONS: Partial<Record<GscErrorCode, Remediation>> = {
  credentials_missing: {
    what: "Nenhuma credencial do Search Console está configurada.",
    why: "Sem credencial o servidor não consegue se autenticar no Google; nenhum dado de busca entra na plataforma.",
    change: "Defina GSC_SERVICE_ACCOUNT_JSON_BASE64 com o JSON da chave da service account codificado em base64 (base64 -w0 chave.json).",
    where: "Variáveis de ambiente do projeto (v0: Settings → Vars; Vercel: Project → Settings → Environment Variables).",
    actor: "operador da plataforma",
    external: false,
  },
  site_url_missing: {
    what: "A propriedade do Search Console não está definida.",
    why: "A validação e as consultas precisam saber exatamente qual propriedade ler.",
    change: "Defina GSC_SITE_URL com o identificador exato, por exemplo sc-domain:exemplo.com.br ou https://www.exemplo.com.br/.",
    where: "Variáveis de ambiente do projeto.",
    actor: "operador da plataforma",
    external: false,
  },
  credential_file_unreadable: {
    what: "O arquivo indicado em GSC_CREDENTIALS_FILE não pôde ser lido.",
    why: "Sem ler a chave, o servidor não se autentica.",
    change: "Corrija o caminho (fora do repositório) ou remova GSC_CREDENTIALS_FILE e use GSC_SERVICE_ACCOUNT_JSON_BASE64.",
    where: "Ambiente local do servidor.",
    actor: "operador da plataforma",
    external: false,
  },
  credential_raw_json: {
    what: "A credencial foi salva como JSON cru, não em base64.",
    why: "O servidor espera base64 para evitar quebras de linha e aspas corrompendo a chave privada.",
    change: "Gere o valor com base64 -w0 chave.json e substitua o conteúdo da variável. Não cole o JSON diretamente.",
    where: "GSC_SERVICE_ACCOUNT_JSON_BASE64 nas variáveis de ambiente do projeto.",
    actor: "operador da plataforma",
    external: false,
  },
  credential_not_base64: {
    what: "O valor da credencial não é base64 válido.",
    why: "Um valor truncado ou com caracteres extras não decodifica para a chave original.",
    change: "Gere novamente com base64 -w0 chave.json, copie o valor inteiro e substitua a variável.",
    where: "GSC_SERVICE_ACCOUNT_JSON_BASE64 nas variáveis de ambiente do projeto.",
    actor: "operador da plataforma",
    external: false,
  },
  credential_not_json: {
    what: "A credencial decodifica, mas não é um JSON válido.",
    why: "O arquivo pode ter sido codificado errado ou não ser a chave JSON da service account.",
    change: "Baixe novamente a chave JSON da service account e codifique o arquivo inteiro em base64.",
    where: "Google Cloud Console → IAM e administrador → Contas de serviço → Chaves; depois, variáveis do projeto.",
    actor: "administrador do Google Cloud",
    external: true,
  },
  credential_oauth_client: {
    what: "A credencial é um cliente OAuth, não uma service account.",
    why: "Clientes OAuth exigem que alguém faça login no navegador; o servidor precisa de uma identidade própria, sem interação.",
    change: "Crie uma service account (sem papéis IAM no projeto), gere uma chave JSON e use-a. Remova o segredo OAuth das variáveis e considere rotacioná-lo.",
    where: "Google Cloud Console → IAM e administrador → Contas de serviço.",
    actor: "administrador do Google Cloud",
    external: true,
  },
  credential_missing_fields: {
    what: "O JSON não tem os campos obrigatórios de uma service account.",
    why: "Sem type=service_account, client_email e private_key não é possível assinar a autenticação.",
    change: "Use a chave JSON completa baixada do Google Cloud, sem editar o arquivo.",
    where: "Google Cloud Console → Contas de serviço → Chaves.",
    actor: "administrador do Google Cloud",
    external: true,
  },
  property_invalid: {
    what: "GSC_SITE_URL não é um identificador de propriedade válido.",
    why: "O Google trata sc-domain: e prefixo de URL como propriedades distintas; um identificador inexato não é encontrado.",
    change: "Copie o identificador exato do seletor de propriedades do Search Console (ex.: sc-domain:exemplo.com.br).",
    where: "GSC_SITE_URL nas variáveis de ambiente do projeto.",
    actor: "operador da plataforma",
    external: false,
  },
  auth_failed: {
    what: "O Google recusou a autenticação da service account.",
    why: "A chave pode ter sido revogada, a conta desativada ou excluída, ou o relógio do servidor está fora de sincronia.",
    change: "Confirme que a service account e a chave estão ativas; se necessário, gere uma chave nova e atualize a variável.",
    where: "Google Cloud Console → Contas de serviço.",
    actor: "administrador do Google Cloud",
    external: true,
  },
  api_disabled: {
    what: "A Google Search Console API não está habilitada no projeto da service account.",
    why: "Com a API desabilitada, toda chamada é recusada, mesmo com credencial e permissão corretas.",
    change: "Habilite \"Google Search Console API\" no projeto da service account e aguarde alguns minutos.",
    where: "Google Cloud Console → APIs e serviços → Biblioteca.",
    actor: "administrador do Google Cloud",
    external: true,
  },
  api_unavailable: {
    what: "A API do Search Console respondeu com indisponibilidade.",
    why: "Falhas temporárias do Google não indicam problema de configuração.",
    change: "Nenhuma mudança necessária agora. Valide novamente em alguns minutos.",
    where: "—",
    actor: "nenhum (aguardar)",
    external: false,
  },
  permission_denied: {
    what: "A service account não tem permissão para esta operação.",
    why: "No Search Console o acesso é concedido por propriedade, não pelo IAM do Google Cloud.",
    change: "Adicione o e-mail da service account como usuário com permissão Restrita na propriedade configurada.",
    where: "Search Console → Configurações → Usuários e permissões.",
    actor: "proprietário da propriedade no Search Console",
    external: true,
  },
  property_not_found: {
    what: "A propriedade configurada não aparece entre as acessíveis pela service account.",
    why: "Ou o identificador não é exatamente o do Search Console, ou a service account ainda não foi adicionada a essa propriedade.",
    change: "Confira o identificador exato (sc-domain: vs. prefixo de URL) e adicione o e-mail da service account com permissão Restrita.",
    where: "Search Console → Configurações → Usuários e permissões; GSC_SITE_URL nas variáveis do projeto.",
    actor: "proprietário da propriedade no Search Console",
    external: true,
  },
  property_unverified: {
    what: "A service account vê a propriedade, mas como usuário não verificado.",
    why: "Usuários não verificados não podem ler dados de desempenho.",
    change: "Peça ao proprietário para adicionar o e-mail da service account com permissão Restrita (ou superior).",
    where: "Search Console → Configurações → Usuários e permissões.",
    actor: "proprietário da propriedade no Search Console",
    external: true,
  },
  rate_limited: {
    what: "O Google limitou temporariamente as requisições.",
    why: "A cota do projeto foi atingida; não é falha de configuração.",
    change: "Aguarde alguns minutos e valide novamente.",
    where: "—",
    actor: "nenhum (aguardar)",
    external: false,
  },
  timeout: {
    what: "O Google não respondeu dentro do tempo limite.",
    why: "Lentidão de rede ou do serviço; a conexão não foi comprovada nem descartada.",
    change: "Valide novamente. Se persistir, verifique a conectividade de saída do servidor.",
    where: "—",
    actor: "nenhum (aguardar)",
    external: false,
  },
  network_error: {
    what: "O servidor não conseguiu alcançar o Google.",
    why: "Falha de rede ou DNS na saída do servidor.",
    change: "Valide novamente. Se persistir, verifique a conectividade de saída do ambiente.",
    where: "Infraestrutura do ambiente de execução.",
    actor: "operador da plataforma",
    external: false,
  },
  unexpected_response: {
    what: "O Google respondeu fora do formato esperado.",
    why: "A resposta não pôde ser interpretada com segurança, então não é tratada como dado.",
    change: "Valide novamente. Se persistir, registre o código e o horário para investigação.",
    where: "—",
    actor: "operador da plataforma",
    external: false,
  },
  upstream_error: {
    what: "O Google devolveu um erro não mapeado.",
    why: "O código HTTP e o motivo permitido ficam registrados para diagnóstico; nada mais da resposta é exposto.",
    change: "Valide novamente. Se persistir, use o código HTTP e o motivo exibidos para investigar.",
    where: "—",
    actor: "operador da plataforma",
    external: false,
  },
};

export function remediationFor(code: GscErrorCode): Remediation | null {
  return REMEDIATIONS[code] ?? null;
}

const STATUS_FOR_CODE: Record<GscErrorCode, GscStatus> = {
  credentials_missing: "not_configured",
  site_url_missing: "not_configured",
  credential_file_unreadable: "invalid_credentials",
  credential_raw_json: "invalid_credentials",
  credential_not_base64: "invalid_credentials",
  credential_not_json: "invalid_credentials",
  credential_oauth_client: "invalid_credentials",
  credential_missing_fields: "invalid_credentials",
  property_invalid: "invalid_property",
  auth_failed: "invalid_credentials",
  api_disabled: "api_not_enabled_or_unavailable",
  api_unavailable: "api_not_enabled_or_unavailable",
  permission_denied: "permission_denied",
  property_not_found: "permission_denied",
  property_unverified: "permission_denied",
  rate_limited: "provider_error",
  timeout: "provider_error",
  network_error: "provider_error",
  unexpected_response: "provider_error",
  upstream_error: "provider_error",
};

export function statusForCode(code: GscErrorCode): GscStatus {
  return STATUS_FOR_CODE[code];
}

/** Compatibilidade com o contrato de provedor existente (requisito 9.3). */
export function toProviderStatus(status: GscStatus): ProviderResult<never>["status"] {
  if (status === "connected") return "success";
  if (status === "connected_no_data") return "no_data";
  if (status === "not_configured" || status === "invalid_credentials" || status === "invalid_property" || status === "configured_not_validated") return "provider_not_configured";
  return "provider_error";
}

// ---------------------------------------------------------------- erros do Google

/** Motivos do Google que podem aparecer na interface. Qualquer outro texto da resposta é descartado. */
const SAFE_REASONS = new Set([
  "accessNotConfigured", "SERVICE_DISABLED", "forbidden", "insufficientPermissions", "PERMISSION_DENIED", "notFound", "NOT_FOUND",
  "rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED", "backendError", "UNAVAILABLE",
  "INTERNAL", "invalid_grant", "invalid_client", "unauthorized_client", "UNAUTHENTICATED", "INVALID_ARGUMENT", "badRequest", "invalid",
]);

export function extractSafeReasons(body: unknown): string[] {
  const out = new Set<string>();
  const visit = (v: unknown, depth: number) => {
    if (depth > 5 || v === null || typeof v !== "object") return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if ((k === "reason" || k === "status" || k === "error") && typeof val === "string" && SAFE_REASONS.has(val)) out.add(val);
      else if (typeof val === "object") visit(val, depth + 1);
    }
  };
  visit(body, 0);
  return [...out];
}

/** Mapeia uma resposta não-2xx de uma API do Search Console. Nunca trata qualquer erro como "credencial inválida". */
export function classifyApiError(httpStatus: number, body: unknown): GscError {
  const reasons = extractSafeReasons(body);
  const upstreamReason = reasons[0];
  const has = (...r: string[]) => r.some((x) => reasons.includes(x));
  if (httpStatus === 429 || has("rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED")) return { code: "rate_limited", httpStatus, upstreamReason };
  if (httpStatus === 401) return { code: "auth_failed", httpStatus, upstreamReason };
  if (httpStatus === 403 && has("accessNotConfigured", "SERVICE_DISABLED")) return { code: "api_disabled", httpStatus, upstreamReason };
  if (httpStatus === 403) return { code: "permission_denied", httpStatus, upstreamReason };
  if (httpStatus === 404) return { code: "property_not_found", httpStatus, upstreamReason };
  if (httpStatus >= 500) return { code: "api_unavailable", httpStatus, upstreamReason };
  return { code: "upstream_error", httpStatus, upstreamReason };
}

/** Remove qualquer coisa com cara de segredo de um texto que vá para log. Defesa extra: o log já recebe só campos estruturados. */
export function redactSecrets(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[chave removida]")
    .replace(/\bya29\.[\w.-]+/g, "[token removido]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt removido]")
    .replace(/\bBearer\s+[\w.-]+/gi, "Bearer [removido]")
    .replace(/\bGOCSPX-[\w-]+/g, "[segredo removido]");
}

// ---------------------------------------------------------------- execução

export type GoogleFetch = (
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface GscValidationDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: GoogleFetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly readFile?: (path: string) => string;
  readonly sign?: (account: ServiceAccount, now: Date) => Promise<string>;
}

export const GSC_SITES_URL = "https://searchconsole.googleapis.com/webmasters/v3/sites";
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Últimos 7 dias completos, terminando 3 dias atrás: os dados do Search Console chegam com atraso de ~2–3 dias. */
export function lastSevenCompleteDays(now: Date): { startDate: string; endDate: string } {
  const day = 86_400_000;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = new Date(todayUtc - 3 * day);
  const start = new Date(end.getTime() - 6 * day);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

class StepFailure extends Error {
  constructor(readonly error: GscError) { super(error.code); }
}

async function request(deps: GscValidationDeps, url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, { ...init, signal: controller.signal });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  } catch (e) {
    if (controller.signal.aborted || (e as Error)?.name === "AbortError") throw new StepFailure({ code: "timeout" });
    throw new StepFailure({ code: "network_error" });
  } finally {
    clearTimeout(timer);
  }
}

type CheckMap = Record<GscCheckId, GscCheck>;

function initialChecks(): CheckMap {
  return Object.fromEntries(GSC_CHECKS.map((id) => [id, { id, state: "not_checked" as GscCheckState }])) as CheckMap;
}

function ordered(map: CheckMap): GscCheck[] {
  return GSC_CHECKS.map((id) => map[id]);
}

const LIVE_STEPS: readonly GscCheckId[] = ["authentication", "api_access", "property_access", "search_analytics"];

interface ConfigOutcome {
  readonly checks: CheckMap;
  readonly property: GscProperty | null;
  readonly identity: GscIdentity | null;
  readonly account: ServiceAccount | null;
  readonly error: GscError | null;
  readonly explanation: string;
}

function evaluateConfig(env: Readonly<Record<string, string | undefined>>, readFile?: (p: string) => string): ConfigOutcome {
  const checks = initialChecks();
  const credential = parseGscCredential(env, readFile);
  const prop = env.GSC_SITE_URL?.trim() ? parseGscProperty(env.GSC_SITE_URL) : null;

  if (!credential) {
    checks.credentials_configured = { id: "credentials_configured", state: "failed", detail: "Nenhuma credencial definida." };
    return { checks, property: prop?.ok ? prop.property : null, identity: null, account: null, error: { code: "credentials_missing" }, explanation: "A integração não está configurada: falta a credencial da service account." };
  }
  checks.credentials_configured = { id: "credentials_configured", state: "passed", detail: credential.ok && credential.source === "file" ? "Arquivo local (GSC_CREDENTIALS_FILE)." : "GSC_SERVICE_ACCOUNT_JSON_BASE64 definida." };

  if (!credential.ok) {
    checks.credential_format = { id: "credential_format", state: "failed", detail: credential.detail };
    return { checks, property: prop?.ok ? prop.property : null, identity: null, account: null, error: { code: credential.code }, explanation: credential.detail };
  }
  checks.credential_format = { id: "credential_format", state: "passed", detail: "Service account com client_email e private_key." };

  if (!prop) {
    return { checks, property: null, identity: credential.identity, account: credential.account, error: { code: "site_url_missing" }, explanation: "A credencial está correta, mas falta definir GSC_SITE_URL." };
  }
  if (!prop.ok) {
    return { checks, property: null, identity: credential.identity, account: credential.account, error: { code: "property_invalid" }, explanation: prop.reason };
  }
  return { checks, property: prop.property, identity: credential.identity, account: credential.account, error: null, explanation: "Configuração local válida. A conexão com o Google ainda não foi comprovada." };
}

function finish(
  base: { mode: "configuration" | "live"; started: Date; now: () => Date; checks: CheckMap; property: GscProperty | null; identity: GscIdentity | null },
  outcome: { status: GscStatus; error: GscError | null; explanation: string; rowsReturned?: number | null; dateRange?: { startDate: string; endDate: string } | null },
): GscValidationResult {
  const finished = base.now();
  return {
    status: outcome.status,
    mode: base.mode,
    property: base.property,
    identity: base.identity,
    checks: ordered(base.checks),
    startedAt: base.started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: Math.max(0, finished.getTime() - base.started.getTime()),
    rowsReturned: outcome.rowsReturned ?? null,
    dateRange: outcome.dateRange ?? null,
    error: outcome.error,
    explanation: outcome.explanation,
    remediation: outcome.error ? remediationFor(outcome.error.code) : null,
  };
}

/**
 * Passo 1–2 (sem rede): diz o que está configurado. Mesmo quando tudo está certo localmente, o status NÃO é "connected":
 * só a validação ao vivo pode afirmar conexão. As etapas que dependem do Google ficam como "pending".
 */
export function diagnoseGscConfiguration(env: Readonly<Record<string, string | undefined>>, opts: { now?: () => Date; readFile?: (p: string) => string } = {}): GscValidationResult {
  const now = opts.now ?? (() => new Date());
  const started = now();
  const cfg = evaluateConfig(env, opts.readFile);
  const base = { mode: "configuration" as const, started, now, checks: cfg.checks, property: cfg.property, identity: cfg.identity };
  if (cfg.error) return finish(base, { status: statusForCode(cfg.error.code), error: cfg.error, explanation: cfg.explanation });
  for (const id of LIVE_STEPS) cfg.checks[id] = { id, state: "pending", detail: "Requer validação ao vivo." };
  return finish(base, { status: "configured_not_validated", error: null, explanation: cfg.explanation });
}

/**
 * Validação completa, somente leitura: autentica, lista propriedades, confere a propriedade e faz uma consulta mínima
 * de Search Analytics. Não escreve nada. Uma resposta 200 sem linhas é conexão válida sem dados.
 */
export async function validateGscConnection(deps: GscValidationDeps): Promise<GscValidationResult> {
  const now = deps.now ?? (() => new Date());
  const started = now();
  const cfg = evaluateConfig(deps.env, deps.readFile);
  const checks = cfg.checks;
  const base = { mode: "live" as const, started, now, checks, property: cfg.property, identity: cfg.identity };
  if (cfg.error || !cfg.account || !cfg.property) {
    const error = cfg.error ?? { code: "credentials_missing" as const };
    return finish(base, { status: statusForCode(error.code), error, explanation: cfg.explanation });
  }
  const account = cfg.account;
  const property = cfg.property;

  let current: GscCheckId = "authentication";
  const fail = (e: GscError, explanation?: string) => {
    checks[current] = { id: current, state: "failed", detail: remediationFor(e.code)?.what };
    return finish(base, { status: statusForCode(e.code), error: e, explanation: explanation ?? remediationFor(e.code)?.what ?? "Falha na validação." });
  };

  try {
    // 3. autenticação (JWT bearer assinado no servidor; o token nunca sai desta função)
    let assertion: string;
    try { assertion = await (deps.sign ?? signAssertion)(account, now()); } catch {
      return fail({ code: "credential_missing_fields" }, "A chave privada da service account não pôde ser lida para assinar a autenticação.");
    }
    const token = await request(deps, account.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    });
    if (token.status !== 200) {
      const reasons = extractSafeReasons(token.body);
      if (token.status >= 500) return fail({ code: "api_unavailable", httpStatus: token.status, upstreamReason: reasons[0] });
      if (token.status === 429) return fail({ code: "rate_limited", httpStatus: token.status, upstreamReason: reasons[0] });
      return fail({ code: "auth_failed", httpStatus: token.status, upstreamReason: reasons[0] });
    }
    const accessToken = (token.body as { access_token?: unknown } | null)?.access_token;
    if (typeof accessToken !== "string" || !accessToken) return fail({ code: "unexpected_response", httpStatus: token.status });
    checks.authentication = { id: "authentication", state: "passed", detail: `Token obtido com escopo ${GSC_SCOPE.split("/").pop()}.` };
    const auth = { Authorization: `Bearer ${accessToken}` };

    // 4. API acessível + lista de propriedades (sites.list devolve tudo numa resposta; não há paginação)
    current = "api_access";
    const sites = await request(deps, GSC_SITES_URL, { method: "GET", headers: auth });
    if (sites.status !== 200) {
      const err = classifyApiError(sites.status, sites.body);
      if (err.code === "property_not_found") return fail({ ...err, code: "upstream_error" });
      return fail(err);
    }
    const entries = (sites.body as { siteEntry?: unknown } | null)?.siteEntry;
    if (entries !== undefined && !Array.isArray(entries)) return fail({ code: "unexpected_response", httpStatus: sites.status });
    const list = (Array.isArray(entries) ? entries : []).filter(
      (e): e is { siteUrl: string; permissionLevel?: string } => !!e && typeof (e as { siteUrl?: unknown }).siteUrl === "string",
    );
    checks.api_access = { id: "api_access", state: "passed", detail: `Search Console API respondeu; ${list.length} propriedade(s) visível(is) para esta identidade.` };

    // 5. propriedade presente, comparação exata (sem trocar domínio por prefixo de URL)
    current = "property_access";
    const match = list.find((e) => e.siteUrl === property.value);
    if (!match) {
      const sameHostOtherKind = list.some((e) => property.kind === "domain" ? e.siteUrl.includes(property.value.slice(10)) : e.siteUrl.startsWith("sc-domain:"));
      return fail({ code: "property_not_found" }, sameHostOtherKind
        ? "A propriedade configurada não está na lista, mas existe uma propriedade de outro tipo para o mesmo site. Domínio e prefixo de URL são propriedades diferentes."
        : undefined);
    }
    if (match.permissionLevel === "siteUnverifiedUser") return fail({ code: "property_unverified" });
    checks.property_access = { id: "property_access", state: "passed", detail: `Acesso ${match.permissionLevel ?? "desconhecido"}.` };

    // 6. consulta mínima: 7 dias completos, dimensão data
    current = "search_analytics";
    const dateRange = lastSevenCompleteDays(now());
    const query = await request(deps, `${GSC_SITES_URL}/${encodeURIComponent(property.value)}/searchAnalytics/query`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ ...dateRange, dimensions: ["date"], rowLimit: 7, type: "web" }),
    });
    if (query.status !== 200) return fail(classifyApiError(query.status, query.body));
    const rows = (query.body as { rows?: unknown } | null)?.rows;
    if (rows !== undefined && !Array.isArray(rows)) return fail({ code: "unexpected_response", httpStatus: query.status });
    const count = Array.isArray(rows) ? rows.length : 0;
    checks.search_analytics = { id: "search_analytics", state: "passed", detail: count ? `${count} dia(s) com dados entre ${dateRange.startDate} e ${dateRange.endDate}.` : `Consulta aceita, sem linhas entre ${dateRange.startDate} e ${dateRange.endDate}.` };

    return finish(base, count
      ? { status: "connected", error: null, explanation: "Conexão comprovada: autenticação, acesso à propriedade e consulta de desempenho funcionaram.", rowsReturned: count, dateRange }
      : { status: "connected_no_data", error: null, explanation: "Conexão comprovada, mas a propriedade não tem dados de desempenho no período consultado. Isso não é falha.", rowsReturned: 0, dateRange });
  } catch (e) {
    if (e instanceof StepFailure) return fail(e.error);
    return fail({ code: "unexpected_response" });
  }
}

/** Evento operacional seguro: só campos estruturados, nunca credencial, token ou corpo de resposta. */
export function validationEvent(result: GscValidationResult, context: { tenantId?: string | null; actor?: string | null } = {}) {
  return {
    event: result.error ? "gsc.validation.failed" : "gsc.validation.succeeded",
    status: result.status,
    mode: result.mode,
    errorCode: result.error?.code ?? null,
    httpStatus: result.error?.httpStatus ?? null,
    propertyKind: result.property?.kind ?? null,
    rowsReturned: result.rowsReturned,
    durationMs: result.durationMs,
    validatedAt: result.finishedAt,
    tenantId: context.tenantId ?? null,
    actor: context.actor ?? null,
  };
}
