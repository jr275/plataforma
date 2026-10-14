import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TEMPLATE_REGISTRY } from "@plataforma/api";
import { TemplateGallery } from "./template-gallery";
import { GeoWorkspace } from "./geo-workspace";
import { SerpWorkspace } from "./serp-workspace";
import { IntelligenceOverview } from "../overview/intelligence-overview";
import { OpportunityJourney } from "../opportunities/journey";
const html = (node: React.ReactElement) => renderToStaticMarkup(node);
describe("limites de dados e contratos da experiência", () => {
  it("visão geral sem sessão não transforma ausência de leitura em métricas zero", () => {
    const out = html(<IntelligenceOverview roadmap={{ state: "unauthenticated" }} trends={{ state: "unauthenticated" }} vertical={{ name: "Teste", country: "BR", language: "pt-BR" }} />);
    expect(out).toContain("Sessão não encontrada"); expect(out).toContain("não consultado"); expect(out).not.toContain("0 registradas"); expect(out).not.toMatch(/Aurora|Northgate|Exemplo Labs/);
  });
  it("galeria deriva o contrato e seus requisitos do registro existente", () => {
    const contracts = TEMPLATE_REGISTRY.map(({ key, version, entityKind, requiredFacts, knownFacts, structuredData, sections }) => ({ key, version, entityKind, requiredFacts, knownFacts, structuredData, sections }));
    const out = html(<TemplateGallery contracts={contracts} />);
    expect(out).toContain("15 de 15"); expect(out).toContain("city-overview"); expect(out).toContain("ibge_code"); expect(out).toContain("Planejado");
  });
  it("galeria não afirma suporte quando o registro está vazio", () => {
    const out = html(<TemplateGallery contracts={[]} />); expect(out).toContain("Sem contrato no registro"); expect(out).not.toContain(">Implementado<");
  });
  it("SERP distingue contexto informado e observação que não foi lida", () => {
    const out = html(<SerpWorkspace query="Consulta de teste" location="BR" />); expect(out).toContain("Definir contexto não executa"); expect(out).toContain("Leitura não conectada"); expect(out).toContain("Sem relações carregadas"); expect(out).not.toContain("position #1");
  });
  it("GEO não inventa citações, estatísticas ou provedores conectados", () => {
    const out = html(<GeoWorkspace limitation="Monitor não implementado" />); for (const name of ["Google AI experiences", "ChatGPT", "Gemini", "Perplexity", "Claude"]) expect(out).toContain(name); expect((out.match(/Sem monitor/g) ?? []).length).toBe(5); expect(out).toContain("Respostas indisponíveis"); expect(out).not.toMatch(/\d+%/);
  });
  it("a jornada mantém o id da oportunidade e não marca etapas como concluídas", () => {
    const out = html(<OpportunityJourney id="id-seguro" active="serp" />); expect(out).toContain('href="/opportunities/id-seguro/serp"'); expect(out).toContain('href="/opportunities/id-seguro/blueprint#previa"'); expect(out).toContain('aria-current="step"'); expect(out).not.toMatch(/conclu[ií]do|aprovado/i);
  });
});
