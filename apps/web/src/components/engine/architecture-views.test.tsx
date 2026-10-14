import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async (orig) => ({ ...(await orig<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }) }));
vi.mock("@/app/(app)/engine/factory-actions", () => ({ analyzeArchitectureAction: async () => null, setMinInlinksAction: async () => null, cancelBatchAction: async () => null, confirmBatchAction: async () => null, createDeploymentAction: async () => null, decidePagesAction: async () => null, planBatchAction: async () => null, refreshDeploymentAction: async () => null, startBatchAction: async () => null, verifyDeploymentAction: async () => null }));
import type { architecture } from "@plataforma/api";
import { ArchitectureSection, ClustersPanel, EligibilityBadges, ruleLabel } from "./architecture-views";

// FIXTURES DE TESTE (formas dos registros devolvidos pelo banco), nunca exibidas em produção.
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const T = new Date("2026-10-14T12:00:00Z");
const cluster = (o: Partial<architecture.ClusterRow> = {}): architecture.ClusterRow => ({ id: "c1", key: "t03:sp", name: "Cidades de SP", archetypeId: "T03", primaryIntent: "informational", domain: "exemplo.com.br", locale: "pt-BR", market: "BR", pages: 4, eligibleApproval: 4, eligibleIndexing: 0, insufficientInlinks: 2, withConflicts: 0, avgQuality: 0.3, ...o });
const archetypes = [{ id: "T03", name: "Cidade", version: "1.0.0" }];
const stored = (over: Partial<architecture.StoredArchitecture> = {}): architecture.StoredArchitecture => ({
  architecture: { archetypeId: "T03", contractVersion: "1.0.0", clusterId: "c1", clusterName: "Cidades de SP", primaryIntent: "informational", intentEvidence: ["padrão cidade"], domain: "exemplo.com.br", locale: "pt-BR", market: "BR", canonicalUrl: "https://exemplo.com.br/cidades/sp/x", canonicalRule: "self", recipeId: "r1", createdAt: T },
  gate: { resultId: "g1", graphId: "gr1", createdAt: T, recipeId: "r1", archetypeId: "T03", contractVersion: "1.0.0", passedRules: [], failedRules: ["contract.indexing"], warnings: [], missingData: ["coordinates"], linkProblems: [], intentConflicts: [], schemaErrors: ["jsonld.breadcrumb_without_hierarchy"], qualityScore: 0.3,
    steps: [{ n: 1, id: "contract_data", name: "Contrato e dados", status: "FAILED", rules: [] }, { n: 2, id: "intent_duplicates", name: "Intenção e duplicidade", status: "PASSED", rules: [] }],
    eligibility: { approval: true, publication: true, indexing: false }, blockedBy: { approval: [], publication: [], indexing: ["contract.indexing", "contract.density"] }, nextActions: ["Completar os dados exigidos para indexação"] },
  inlinks: [{ fromId: "aaaaaaaa-0000", toId: "x", toPath: "/cidades/sp/x", relation: "related", moduleId: "related", reason: "Cidade vizinha", state: "VALID", invalidReason: null, otherUrl: "/cidades/sp/y" }],
  outlinks: [{ fromId: "x", toId: null, toPath: "/cidades", relation: "hub", moduleId: null, reason: "Hub", state: "INVALID", invalidReason: "DESTINATION_MISSING", otherUrl: null }], ...over });

describe("clusters e política de links", () => {
  it("mostra clusters com contagens, filtros por cluster e a política vigente; elegível para indexação não é indexada", () => {
    const out = html(<ClustersPanel clusters={[cluster()]} minInlinks={3} archetypes={archetypes} />);
    expect(out).toContain("Cidades de SP"); expect(out).toContain("/engine/pages?cluster=c1&amp;linkFailure=1"); expect(out).toContain("Mínimo vigente: 3"); expect(out).toContain("Não significa indexadas"); expect(out).toContain('data-testid="archetype-list"'); expect(out).toContain("T03");
    expect(out).not.toContain("conflito=1"); expect(out).toContain("0.30");
  });
  it("sem páginas analisadas, explica o que fazer em vez de mostrar zeros como resultado", () => {
    const out = html(<ClustersPanel clusters={[]} minInlinks={3} archetypes={archetypes} />);
    expect(out).toContain("Nenhuma página analisada ainda"); expect(out).not.toContain('data-testid="clusters-table"'); expect(out).toContain("Reanalisar");
  });
});
describe("seção de arquitetura da página", () => {
  it("separa as três elegibilidades, lista as regras bloqueantes por nível, próximas ações e inlinks/outlinks com estado", () => {
    const out = html(<ArchitectureSection a={stored()} />);
    expect(out).toContain("Aprovação: liberada"); expect(out).toContain("Publicação: liberada"); expect(out).toContain("Indexação: bloqueada"); expect(out).toContain("contract.indexing"); expect(out).toContain("Densidade de dados"); expect(out).toContain("Completar os dados exigidos");
    expect(out).toContain('data-edge-state="VALID"'); expect(out).toContain('data-edge-state="INVALID"'); expect(out).toContain("DESTINATION_MISSING"); expect(out).toContain("não é indexação"); expect(out).toContain("Dados ausentes");
  });
  it("sem análise, é um estado vazio explicado; sem resultado do gate, não inventa elegibilidade", () => {
    expect(html(<ArchitectureSection a={null} />)).toContain("Sem análise de arquitetura");
    const out = html(<ArchitectureSection a={stored({ gate: null })} />); expect(out).toContain("Sem resultado do Quality Gate"); expect(out).not.toContain("liberada");
  });
  it("rótulos conhecidos e id desconhecido volta como está", () => { expect(ruleLabel("links.inlinks_min")).toBe("Inlinks contextuais mínimos"); expect(ruleLabel("x.y")).toBe("x.y"); expect(html(<EligibilityBadges gate={null} />)).toContain("sem análise"); });
});
