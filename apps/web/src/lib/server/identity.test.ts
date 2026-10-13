import { beforeEach, describe, expect, it, vi } from "vitest";

// Fronteiras mockadas: cookies do Next, cliente do Supabase e o autenticador (que verifica o JWT). O encadeamento (config → sessão → token →
// autenticador → estado) é o REAL.
const getSession = vi.fn();
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ getAll: () => [] })) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn(() => ({ auth: { getSession } })) }));
const authenticate = vi.fn();
vi.mock("@plataforma/api", async (orig) => ({
  ...(await orig<typeof import("@plataforma/api")>()),
  createSupabaseAuthenticator: vi.fn(() => ({ authenticate })),
  supabaseJwks: vi.fn((issuer: string) => ({ jwksFor: issuer })),
}));

import * as api from "@plataforma/api";
import { createServerClient } from "@supabase/ssr";
import { requestIdentity } from "./identity";

const URL_OK = "https://projeto.supabase.co";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_OK);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_exemplo_de_teste");
});

describe("requestIdentity", () => {
  it("sem URL ou chave pública do Supabase: not_configured, e nem cria o cliente", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await requestIdentity()).toEqual({ state: "not_configured" });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_OK);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(await requestIdentity()).toEqual({ state: "not_configured" });
    expect(createServerClient).not.toHaveBeenCalled();
  });
  it("sem token de sessão: unauthenticated, sem chamar o autenticador", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    expect(await requestIdentity()).toEqual({ state: "unauthenticated" });
    expect(authenticate).not.toHaveBeenCalled();
  });
  it("token da sessão é VERIFICADO no servidor: emissor, algoritmos fixos e JWKS do próprio projeto; devolve a identidade verificada", async () => {
    const verified = api.devIdentity(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
    getSession.mockResolvedValue({ data: { session: { access_token: "TOKEN.DA.SESSAO" } } });
    authenticate.mockResolvedValue(verified);
    expect(await requestIdentity()).toEqual({ state: "ok", identity: verified });
    expect(authenticate).toHaveBeenCalledExactlyOnceWith("TOKEN.DA.SESSAO");
    expect(api.createSupabaseAuthenticator).toHaveBeenCalledWith({ issuer: `${URL_OK}/auth/v1`, key: { jwksFor: `${URL_OK}/auth/v1` }, algorithms: ["ES256", "RS256"] });
  });
  it("URL com barra no fim gera o mesmo emissor", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `${URL_OK}/`);
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    authenticate.mockResolvedValue(api.devIdentity([]));
    await requestIdentity();
    expect(vi.mocked(api.createSupabaseAuthenticator).mock.calls[0]![0].issuer).toBe(`${URL_OK}/auth/v1`);
  });
  it("token recusado (expirado, assinatura ruim etc.): unauthenticated, nunca uma identidade", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "ruim" } } });
    for (const reason of ["expired", "signature", "malformed", "claims"] as const) {
      authenticate.mockRejectedValueOnce(new api.AuthenticationError(reason));
      expect(await requestIdentity()).toEqual({ state: "unauthenticated" });
    }
  });
  it("falha que NÃO é de autenticação (rede, bug) não vira 'sem sessão': é propagada", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    authenticate.mockRejectedValueOnce(new TypeError("falha inesperada"));
    await expect(requestIdentity()).rejects.toThrow(/falha inesperada/);
  });
});
