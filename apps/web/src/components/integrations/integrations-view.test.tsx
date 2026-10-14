import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildIntegrations } from "@/lib/server/integrations";
import { IntegrationsView } from "./integrations-view";

const ENV = { NEXT_PUBLIC_SUPABASE_URL: "https://projeto-secreto.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_SEGREDO", PLATAFORMA_APP_DATABASE_URL: "postgresql://u:SENHA@h/db" };
const out = renderToStaticMarkup(<IntegrationsView entries={buildIntegrations({ env: ENV, identity: "ok", database: { state: "ready", data: { cities: 5571, realRuns: 1, lastRealRun: "succeeded" }, origin: { kind: "local", host: "socket local" } } })} />);

describe("tela de integrações", () => {
  it("mostra o estado de cada integração, com selos distintos e a dependência exata das bloqueadas", () => {
    expect(out).toContain("Operacional (verificado agora)");
    expect(out).toContain("Bloqueado: depende de terceiros");
    expect(out).toContain('data-testid="integration-search-console"');
    expect(out).toContain('data-status="blocked_external"');
    expect(out).toContain("OAuth do dono da propriedade");
    expect(out).toContain("Para destravar:");
    expect(out).toContain("cidades do IBGE não substituem o inventário");
  });
  it("diz que presença de variável não é integração operacional e que nenhum valor é exibido", () => {
    expect(out).toContain("Variável presente não é integração operacional");
    expect(out).toContain("Nenhum valor de configuração é exibido");
  });
  it("lista só nomes de variáveis (com 'definida'/'ausente' para leitores de tela) e nunca valores", () => {
    expect(out).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(out).toContain("(definida)");
    expect(out).not.toMatch(/SEGREDO|SENHA|projeto-secreto|postgresql:|sb_publishable/);
  });
  it("agrupa por categoria", () => {
    for (const c of ["Plataforma", "Fonte de dados", "Publicação e medição"]) expect(out).toContain(c);
  });
});
