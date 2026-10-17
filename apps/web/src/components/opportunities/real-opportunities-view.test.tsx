import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Opportunity } from "@plataforma/api";
import type { Loaded } from "@/lib/server/tenant-data";
import { DemoFallbackNotice } from "./demo-notice";
import { RealOpportunityDetail } from "./real-opportunity-detail";
import { RealOpportunitiesView, type BlockedState } from "./real-opportunities-view";

// FIXTURES de teste: registros montados à mão no formato de `Opportunity`; NÃO representam dados de produção.
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const origin = { kind: "local" as const, host: "socket local" };
const ready = <T,>(data: T): Loaded<T> => ({ state: "ready", data, origin });
const opp = (over: Partial<Opportunity> = {}): Opportunity => ({
  id: "a0000000-0000-4000-8000-000000000001", tenantId: "b0000000-0000-4000-8000-000000000001",
  title: "Guia de imóveis em Campinas", summary: "Resumo da oportunidade.", nextAction: "Montar o blueprint.", kind: "page", intent: "informational",
  demand: "high", competition: "medium", evidence: "low", status: "candidate", rank: 1,
  rationale: ["Demanda local alta."], gaps: ["Falta fonte de preços."],
  createdAt: new Date("2026-10-01T12:00:00Z"), updatedAt: new Date("2026-10-02T12:00:00Z"), ...over,
});

describe("estados em que a tela não pode mostrar dados", () => {
  const cases: [BlockedState, RegExp][] = [
    ["not_configured", /não está configurada/], ["unauthenticated", /Sessão não encontrada/], ["no_tenant", /não está associado a um workspace/],
    ["tenant_selection_required", /Seleção de workspace necessária/],
    ["not_migrated", /tabela de oportunidades ainda não existe[\s\S]*migrations 0001 e 0002/], ["error", /Não foi possível ler/],
  ];
  for (const [state, text] of cases) {
    it(`${state}: explica o motivo e nunca simula dados`, () => {
      const loaded = (state === "not_configured" ? { state, missing: "banco" } : { state }) as Loaded<readonly Opportunity[]>;
      const out = html(<RealOpportunitiesView loaded={loaded} />);
      expect(out).toMatch(text);
      expect(out).not.toMatch(/Exemplo Labs|Northgate|score|pontuação/i);
      expect(out).not.toContain("<table");
    });
    it(`${state}: o detalhe também explica o motivo`, () => {
      const loaded = (state === "not_configured" ? { state, missing: "banco" } : { state }) as Loaded<Opportunity | null>;
      expect(html(<RealOpportunityDetail loaded={loaded} />)).toMatch(text);
    });
  }
  it("não vaza a mensagem do banco: o estado de erro não carrega texto livre", () => {
    expect(html(<RealOpportunitiesView loaded={{ state: "error" }} />)).not.toMatch(/postgres|password|host=|42P01/i);
  });
});

describe("lista real", () => {
  it("vazia: mensagem honesta, sem tabela e sem dado inventado", () => {
    const out = html(<RealOpportunitiesView loaded={ready([])} />);
    expect(out).toContain("Nenhuma oportunidade neste workspace ainda");
    expect(out).not.toContain("<table");
  });
  it("mostra ordem, fatores separados e status, com link para o detalhe", () => {
    const out = html(<RealOpportunitiesView loaded={ready([opp(), opp({ id: "a0000000-0000-4000-8000-000000000002", title: "FAQ de financiamento", rank: 2, status: "blocked", demand: "low" })])} />);
    expect(out).toContain("Guia de imóveis em Campinas");
    expect(out).toContain('href="/opportunities/a0000000-0000-4000-8000-000000000001"');
    expect(out).toMatch(/Demanda[\s\S]*Concorrência[\s\S]*Evidência/);
    expect(out).toContain("Candidata");
    expect(out).toContain("Bloqueada");
    expect(out).toContain("Dados reais");
  });
  it("não existe nota composta nem pontuação (regra 5 e ADR-002)", () => {
    const out = html(<RealOpportunitiesView loaded={ready([opp()])} />);
    expect(out).not.toMatch(/score|pontuação|Ajustar pesos|risco/i);
  });
  it("a tabela é acessível: legenda, cabeçalhos com escopo", () => {
    const out = html(<RealOpportunitiesView loaded={ready([opp()])} />);
    expect(out).toContain("<caption");
    expect(out.match(/scope="col"/g)?.length).toBe(7);
  });
});

describe("detalhe real", () => {
  it("mostra os três fatores separados, ação, justificativa e lacunas", () => {
    const out = html(<RealOpportunityDetail loaded={ready<Opportunity | null>(opp())} />);
    expect(out).toContain("Guia de imóveis em Campinas");
    expect(out).toMatch(/Demanda[\s\S]*Concorrência[\s\S]*Evidência/);
    expect(out).toContain("Montar o blueprint.");
    expect(out).toContain("Demanda local alta.");
    expect(out).toContain("Falta fonte de preços.");
  });
  it("mostra só as ações de status válidas para o estado atual (candidata: enviar para revisão ou descartar)", () => {
    const out = html(<RealOpportunityDetail loaded={ready<Opportunity | null>(opp({ status: "candidate" }))} />);
    expect(out).toContain("Enviar para revisão");
    expect(out).toContain("Descartar");
    expect(out).not.toContain("Aprovar para os gates"); // não se pula a revisão
    expect(out).toContain('name="id"');
  });
  it("descartada só oferece restaurar", () => {
    const out = html(<RealOpportunityDetail loaded={ready<Opportunity | null>(opp({ status: "dismissed" }))} />);
    expect(out).toContain("Restaurar oportunidade");
    expect(out).not.toContain("Descartar</button>");
  });
  it("registro inexistente ou de outro tenant: o mesmo 'não encontrada', sem pista de que existe", () => {
    const out = html(<RealOpportunityDetail loaded={ready<Opportunity | null>(null)} />);
    expect(out).toContain("Oportunidade não encontrada");
    expect(out).not.toMatch(/outro workspace|outro tenant|sem permissão/i);
  });
  it("listas vazias viram estado explícito, não texto inventado", () => {
    const out = html(<RealOpportunityDetail loaded={ready<Opportunity | null>(opp({ rationale: [], gaps: [] }))} />);
    expect(out).toContain("Sem justificativa registrada");
    expect(out).toContain("Nenhuma lacuna registrada");
  });
});

describe("aviso de demonstração", () => {
  it("diz que é demonstração e o que falta configurar", () => {
    const out = html(<DemoFallbackNotice missing="banco de dados (PLATAFORMA_APP_DATABASE_URL)" />);
    expect(out).toContain("Dados de demonstração");
    expect(out).toContain("PLATAFORMA_APP_DATABASE_URL");
    expect(out).toContain('role="note"');
  });
});
