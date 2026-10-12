import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthenticationError, TenantAccessDeniedError, bearerToken, createSupabaseAuthenticator, withTenant, type PoolLike, type SupabaseAuthConfig } from "../index";

// Testes SEM rede: as chaves são geradas aqui e o resolvedor de chaves é local. Cobrem o que um atacante tentaria: token expirado,
// emissor ou audiência trocados, assinatura inválida, `alg: none`, confusão de algoritmo, claims ausentes ou malformadas.
const ISS = "https://projeto.example/auth/v1";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "11111111-1111-4111-8111-111111111111";

let priv: CryptoKey;
let pub: CryptoKey;
let otherPriv: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  priv = pair.privateKey;
  pub = pair.publicKey;
  otherPriv = (await generateKeyPair("ES256")).privateKey;
  jwk = { ...(await exportJWK(pub)), kid: "k1", alg: "ES256", use: "sig" };
});

const config = (over: Partial<SupabaseAuthConfig> = {}): SupabaseAuthConfig => ({ issuer: ISS, key: pub, algorithms: ["ES256"], ...over });

async function token(claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; iss?: string; aud?: string | null; exp?: string | number; nbf?: number; alg?: string; kid?: string } = {}) {
  const jwt = new SignJWT({ role: "authenticated", app_metadata: { tenant_ids: [A, B] }, ...claims })
    .setProtectedHeader({ alg: opts.alg ?? "ES256", kid: opts.kid ?? "k1" })
    .setIssuedAt()
    .setIssuer(opts.iss ?? ISS)
    .setExpirationTime(opts.exp ?? "1h");
  if (!("sub" in claims)) jwt.setSubject(USER);
  if (opts.aud !== null) jwt.setAudience(opts.aud ?? "authenticated");
  if (opts.nbf !== undefined) jwt.setNotBefore(opts.nbf);
  return jwt.sign(opts.key ?? priv);
}

const reasonOf = async (p: Promise<unknown>) => {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(AuthenticationError);
  return (e as AuthenticationError).reason;
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe("autenticador do Supabase (sem rede)", () => {
  it("aceita um token válido e devolve a identidade com os tenants da claim assinada", async () => {
    const id = await createSupabaseAuthenticator(config()).authenticate(await token());
    expect(id.userId).toBe(USER);
    expect([...id.tenantIds]).toEqual([A, B]);
    expect(Object.isFrozen(id)).toBe(true);
  });

  it("aceita um resolvedor de chaves (JWKS local) e escolhe a chave pelo kid", async () => {
    const auth = createSupabaseAuthenticator(config({ key: createLocalJWKSet({ keys: [jwk] }) }));
    expect((await auth.authenticate(await token())).userId).toBe(USER);
    expect(await reasonOf(auth.authenticate(await token({}, { kid: "desconhecido" })))).toBe("signature");
  });

  it("sem a claim de tenants a identidade não tem nenhum tenant (e não é um erro)", async () => {
    const auth = createSupabaseAuthenticator(config());
    expect([...(await auth.authenticate(await token({ app_metadata: {} }))).tenantIds]).toEqual([]);
    expect([...(await auth.authenticate(await token({ app_metadata: undefined }))).tenantIds]).toEqual([]);
  });

  it("recusa token expirado, ainda não válido e respeita a tolerância de relógio", async () => {
    const auth = createSupabaseAuthenticator(config());
    expect(await reasonOf(auth.authenticate(await token({}, { exp: Math.floor(Date.now() / 1000) - 10 })))).toBe("expired");
    expect(await reasonOf(auth.authenticate(await token({}, { nbf: Math.floor(Date.now() / 1000) + 600 })))).toBe("not_yet_valid");
    const tolerant = createSupabaseAuthenticator(config({ clockToleranceSeconds: 30 }));
    expect((await tolerant.authenticate(await token({}, { exp: Math.floor(Date.now() / 1000) - 10 }))).userId).toBe(USER);
  });

  it("recusa emissor ou audiência trocados, ou audiência ausente", async () => {
    const auth = createSupabaseAuthenticator(config());
    expect(await reasonOf(auth.authenticate(await token({}, { iss: "https://outro.example/auth/v1" })))).toBe("claims");
    expect(await reasonOf(auth.authenticate(await token({}, { aud: "outra" })))).toBe("claims");
    expect(await reasonOf(auth.authenticate(await token({}, { aud: null })))).toBe("claims");
  });

  it("recusa assinatura de outra chave e token adulterado", async () => {
    const auth = createSupabaseAuthenticator(config());
    expect(await reasonOf(auth.authenticate(await token({}, { key: otherPriv })))).toBe("signature");
    const [h, , s] = (await token()).split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: USER, role: "authenticated", aud: "authenticated", iss: ISS, exp: 9999999999, app_metadata: { tenant_ids: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"] } })).toString("base64url")}.${s}`;
    expect(await reasonOf(auth.authenticate(forged))).toBe("signature");
  });

  it("recusa `alg: none` (token sem assinatura)", async () => {
    const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: USER, role: "authenticated", aud: "authenticated", iss: ISS, exp: 9999999999 })}.`;
    expect(["signature", "malformed"]).toContain(await reasonOf(createSupabaseAuthenticator(config()).authenticate(unsigned)));
  });

  it("recusa a confusão de algoritmo: HS256 assinado com a chave pública como segredo", async () => {
    const secret = new TextEncoder().encode(JSON.stringify(jwk));
    const hs = await new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "HS256" }).setSubject(USER).setIssuer(ISS).setAudience("authenticated").setExpirationTime("1h").sign(secret);
    expect(["signature", "malformed"]).toContain(await reasonOf(createSupabaseAuthenticator(config()).authenticate(hs)));
  });

  it("recusa sub ausente ou vazio, papel diferente de authenticated e exp ausente", async () => {
    const auth = createSupabaseAuthenticator(config());
    const noSub = await new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "ES256" }).setIssuer(ISS).setAudience("authenticated").setExpirationTime("1h").sign(priv);
    expect(await reasonOf(auth.authenticate(noSub))).toBe("claims");
    expect(await reasonOf(auth.authenticate(await token({ sub: "" })))).toBe("claims");
    expect(await reasonOf(auth.authenticate(await token({ role: "anon" })))).toBe("claims");
    const noExp = await new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "ES256" }).setSubject(USER).setIssuer(ISS).setAudience("authenticated").sign(priv);
    expect(await reasonOf(auth.authenticate(noExp))).toBe("claims");
  });

  it("recusa o token inteiro se a claim de tenants é malformada (nada é consertado em silêncio)", async () => {
    const auth = createSupabaseAuthenticator(config());
    for (const app_metadata of [{ tenant_ids: "x" }, { tenant_ids: [A, "não-é-uuid"] }, { tenant_ids: [A, 5] }, { tenant_ids: Array(101).fill(A) }, [A], "texto"]) {
      expect(await reasonOf(auth.authenticate(await token({ app_metadata })))).toBe("tenant_claim");
    }
  });

  it("recusa entradas que não são um token: não texto, vazio e grande demais", async () => {
    const auth = createSupabaseAuthenticator(config({ maxTokenBytes: 64 }));
    for (const bad of [undefined, null, 42, {}, "", "a.b", "x".repeat(65)]) expect(await reasonOf(auth.authenticate(bad))).toBe("malformed");
    expect(await reasonOf(createSupabaseAuthenticator(config()).authenticate("não.é.token"))).toBe("malformed");
  });

  it("a mensagem do erro nunca contém o token", async () => {
    const t = await token({}, { key: otherPriv });
    const e = (await createSupabaseAuthenticator(config()).authenticate(t).then(() => undefined, (x: unknown) => x)) as AuthenticationError;
    expect(e.message).not.toContain(t.slice(0, 20));
    expect(e.code).toBe("AUTH_INVALID_TOKEN");
  });

  it("valida a configuração: emissor vazio, algoritmo none, tolerância fora do limite", () => {
    expect(() => createSupabaseAuthenticator(config({ issuer: "" }))).toThrow(TypeError);
    expect(() => createSupabaseAuthenticator(config({ algorithms: ["none" as never] }))).toThrow(TypeError);
    expect(() => createSupabaseAuthenticator(config({ clockToleranceSeconds: 61 }))).toThrow(TypeError);
    expect(() => createSupabaseAuthenticator(config({ clockToleranceSeconds: 1.5 }))).toThrow(TypeError);
  });

  it("extrai o token do cabeçalho Authorization e recusa formatos inválidos", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("bearer   abc")).toBe("abc");
    for (const bad of [undefined, null, "", "Basic abc", "Bearer", "Bearer a b", "abc"]) expect(() => bearerToken(bad as string)).toThrow(AuthenticationError);
  });

  it("integra com withTenant: um tenant que NÃO consta na claim é recusado antes de abrir conexão", async () => {
    const auth = createSupabaseAuthenticator(config());
    const id = await auth.authenticate(await token({ app_metadata: { tenant_ids: [A] } }));
    let connected = false;
    const pool: PoolLike = { async connect() { connected = true; throw new Error("não deveria conectar"); } };
    await expect(withTenant(pool, id, B, async () => "x")).rejects.toBeInstanceOf(TenantAccessDeniedError);
    expect(connected).toBe(false);
  });
});
