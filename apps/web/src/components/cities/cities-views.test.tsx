import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CityDetail, CityListItem } from "@plataforma/api";
import { parseCityParams } from "@/lib/server/cities";
import type { Loaded } from "@/lib/server/tenant-data";
import { isRealDataRoute, navigation } from "@/config/navigation";
import { CitiesHomeView, cityHref, type CitiesData } from "./cities-home-view";
import { CityDetailView, type CityDetailData } from "./city-detail-view";
import type { BlockedState } from "@/components/generation/state-panel";

// FIXTURES de teste: valores do IBGE (extrato de 2026-10-12) usados só como entrada; os registros são montados à mão e NÃO representam dados de produção.
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const origin = { kind: "local" as const, host: "socket local" };
const ready = <T,>(data: T): Loaded<T> => ({ state: "ready", data, origin });
const P = parseCityParams({});
const RUN = "c0000000-0000-4000-8000-000000000001";
const item = (over: Partial<CityListItem> = {}): CityListItem => ({ id: "d0000000-0000-4000-8000-000000000001", ibgeCode: "3550308", name: "São Paulo", uf: "SP", region: "Sudeste", population: 11911337, populationYear: 2026, sourceRunId: RUN, sourceName: "IBGE", sourceOrigin: "real", pageId: null, pagePath: null, pageStatus: null, ...over });
const data = (over: Partial<CitiesData> = {}): CitiesData => ({ cities: { rows: [item()], total: 1 }, summary: { total: 1, withPage: 0 }, ...over });

describe("parâmetros da URL das cidades (defensivos)", () => {
  it("padrões, valores fora da lista e limites", () => {
    expect(parseCityParams({})).toEqual({ q: "", uf: "", pages: "", sort: "name", dir: "asc", page: 1 });
    expect(parseCityParams({ q: "x".repeat(200), uf: "zz", pages: "talvez", sort: "name; DROP TABLE", dir: "sideways", page: "-3" })).toEqual({ q: "x".repeat(80), uf: "", pages: "", sort: "name", dir: "asc", page: 1 });
    expect(parseCityParams({ q: "  campinas ", uf: "sp", pages: "with", sort: "population", dir: "desc", page: "3" })).toEqual({ q: "campinas", uf: "SP", pages: "with", sort: "population", dir: "desc", page: 3 });
    expect(parseCityParams({ page: ["2", "3"], q: ["a"] }).page).toBe(1); // arrays não são aceitos
    expect(parseCityParams({ page: "10001" }).page).toBe(1);
    expect(parseCityParams({ pages: "without" }).pages).toBe("without");
  });
  it("cityHref preserva os filtros e omite os padrões", () => {
    expect(cityHref(P, {})).toBe("/cities");
    expect(cityHref({ ...P, q: "campinas", uf: "SP", pages: "with" }, { page: 2 })).toBe("/cities?q=campinas&uf=SP&pages=with&page=2");
  });
});

describe("navegação e rótulo de dado real", () => {
  it("'Cidades' está no menu e a rota é marcada como dado REAL (não demonstração)", () => {
    expect(navigation.flatMap((g) => g.items).some((i) => i.href === "/cities")).toBe(true);
    expect(isRealDataRoute("/cities")).toBe(true);
    expect(isRealDataRoute("/cities/abc")).toBe(true);
    expect(isRealDataRoute("/entities")).toBe(false); // a tela de entidades continua demonstração
  });
});

describe("lista de cidades: estados em que não há dados", () => {
  const states: [BlockedState, RegExp][] = [
    ["not_configured", /não está configurada/], ["unauthenticated", /Sessão não encontrada/], ["no_tenant", /não está associado a um workspace/], ["not_migrated", /migrations/],
    ["db_unavailable", /banco de dados não respondeu/], ["auth_unavailable", /não conseguimos verificar a sua sessão/i], ["error", /Não foi possível ler/],
  ];
  for (const [state, text] of states) {
    it(`${state}: explica o motivo; nunca mostra tabela nem diz que não há cidades`, () => {
      const out = html(<CitiesHomeView loaded={state === "not_configured" ? { state, missing: "banco" } : ({ state } as Loaded<CitiesData>)} params={P} pageSize={20} />);
      expect(out).toMatch(text);
      expect(out).not.toContain("<table");
      expect(out).not.toMatch(/Nenhuma cidade/);
    });
  }
});

describe("lista de cidades", () => {
  it("vazio de verdade: diz que nada foi importado e onde ver o histórico", () => {
    const out = html(<CitiesHomeView loaded={ready(data({ cities: { rows: [], total: 0 } }))} params={P} pageSize={20} />);
    expect(out).toContain("Nenhuma cidade importada ainda");
    expect(out).toContain('href="/data-flow"');
  });
  it("com filtro e sem resultado: mensagem própria e link para limpar", () => {
    const out = html(<CitiesHomeView loaded={ready(data({ cities: { rows: [], total: 0 } }))} params={{ ...P, q: "zzz" }} pageSize={20} />);
    expect(out).toContain("Nenhuma cidade com esses filtros");
    expect(out).toContain('href="/cities"');
  });
  it("página fora do intervalo (há cidades, mas esta página não existe): não diz 'nenhuma cidade' e leva à primeira e à última", () => {
    const out = html(<CitiesHomeView loaded={ready(data({ cities: { rows: [], total: 45 } }))} params={{ ...P, page: 9 }} pageSize={20} />);
    expect(out).not.toContain("Nenhuma cidade");
    expect(out).toContain("Esta página de resultados não existe");
    expect(out).toContain('href="/cities"');
    expect(out).toContain('href="/cities?page=3"');
  });
  it("com dados: tabela acessível, link para o detalhe, população formatada, página gerada com status, origem e paginação preservando filtros", () => {
    const rows = [
      item({ pageId: "e0000000-0000-4000-8000-000000000001", pagePath: "/cidades/sp/sao-paulo", pageStatus: "draft" }),
      item({ id: "d0000000-0000-4000-8000-000000000002", ibgeCode: "3500501", name: "Águas de Lindóia", population: null, populationYear: null }),
      item({ id: "d0000000-0000-4000-8000-000000000003", ibgeCode: "3509502", name: "Campinas", sourceOrigin: "test" }),
    ];
    const out = html(<CitiesHomeView loaded={ready(data({ cities: { rows, total: 45 } }))} params={{ ...P, q: "a", page: 2 }} pageSize={20} />);
    expect(out).toContain('<caption class="sr-only">Cidades do workspace</caption>');
    expect(out).toContain('scope="col"');
    expect(out).toContain('href="/cities/d0000000-0000-4000-8000-000000000001"');
    expect(out).toContain("11.911.337");
    expect(out).toContain('href="/generation/pages/e0000000-0000-4000-8000-000000000001"');
    expect(out).toContain("Rascunho");
    expect(out).toContain("Sem página"); // cidade sem página gerada
    expect(out).toContain("—"); // população ausente aparece como traço, nunca zero
    expect(out).toContain("Mostrando 21 a 40 de 45");
    expect(out).toContain('href="/cities?q=a"'); // anterior
    expect(out).toContain('href="/cities?q=a&amp;page=3"'); // próxima
    expect(out).toContain("Banco: local (ambiente de desenvolvimento)");
    expect(out).toContain('href="/graph?node=city:d0000000-0000-4000-8000-000000000001"'); // cada linha leva ao grafo
    expect(out).toContain('aria-label="Ver São Paulo no grafo"');
  });
  it("indicadores do workspace inteiro (não só da página): total, com página e sem página", () => {
    const out = html(<CitiesHomeView loaded={ready(data({ summary: { total: 5571, withPage: 20 } }))} params={{ ...P, q: "x" }} pageSize={20} />);
    expect(out).toContain('aria-label="Indicadores do workspace"');
    expect(out).toContain("5.571");
    expect(out).toContain(">20<");
    expect(out).toContain("5.551"); // 5571 - 20, calculado
  });
  it("a origem de cada cidade é rotulada com a verdade: 'real' só para origem real; teste e manual aparecem como tal", () => {
    const out = html(<CitiesHomeView loaded={ready(data({ cities: { rows: [item({ sourceOrigin: "real" }), item({ id: "d0000000-0000-4000-8000-000000000002", sourceOrigin: "test" }), item({ id: "d0000000-0000-4000-8000-000000000003", sourceOrigin: "manual" })], total: 3 } }))} params={P} pageSize={20} />);
    expect(out).toContain("Real");
    expect(out).toContain("Teste");
    expect(out).toContain("Manual");
  });
  it("o formulário de filtro tem rótulos, as 27 UFs e usa GET (a URL é o estado)", () => {
    const out = html(<CitiesHomeView loaded={ready(data())} params={P} pageSize={20} />);
    expect(out).toContain('method="get"');
    expect(out).toContain('role="search"');
    expect((out.match(/<option value="[A-Z]{2}"/g) ?? []).length).toBeGreaterThanOrEqual(27);
    expect(out).toContain("Buscar por nome ou código IBGE");
  });
});

describe("detalhe da cidade e proveniência", () => {
  const full = (over: Partial<CityDetail> = {}): CityDetailData => ({
    detail: {
      city: { id: "d0000000-0000-4000-8000-000000000001", ibgeCode: "3550308", name: "São Paulo", uf: "SP", region: "Sudeste", population: 11911337, populationYear: 2026, sourceRunId: RUN },
      source: { runId: RUN, sourceName: "IBGE", origin: "real", fileName: "sp-ibge-2026-10-12.csv", fileSha256: "ab".repeat(32), status: "succeeded", totalRows: 645, acceptedRows: 645, startedAt: new Date("2026-10-12T20:00:00Z"), finishedAt: new Date("2026-10-12T20:00:05Z") },
      record: { rowNumber: 410, raw: { ibge_code: "3550308", name: "São Paulo", uf: "SP", region: "Sudeste", population: "11911337", population_year: "2026" }, outcome: "accepted", issues: [], entityId: "d0000000-0000-4000-8000-000000000001" },
      page: { id: "e0000000-0000-4000-8000-000000000001", path: "/cidades/sp/sao-paulo", status: "draft", latestVersion: 2, updatedAt: new Date("2026-10-13T03:10:00Z") },
      relations: { uf: { code: "SP", cityCount: 645 }, region: { name: "Sudeste", cityCount: 645 } },
      ...over,
    },
  });
  it("mostra atributos, a execução de origem, a linha original, a página gerada e as relações derivadas da fonte", () => {
    const out = html(<CityDetailView loaded={ready(full())} />);
    expect(out).toContain("São Paulo, SP");
    expect(out).toContain("3550308");
    expect(out).toContain("11.911.337");
    expect(out).toContain("Sudeste");
    expect(out).toContain("sp-ibge-2026-10-12.csv");
    expect(out).toContain("ab".repeat(32)); // sha256 completo, para conferência independente
    expect(out).toContain("Real");
    expect(out).toContain('href="/data-flow?run=c0000000-0000-4000-8000-000000000001"');
    expect(out).toContain("linha 410");
    expect(out).toContain("Aceita");
    expect(out).toContain('href="/generation/pages/e0000000-0000-4000-8000-000000000001"');
    expect(out).toContain("/cidades/sp/sao-paulo");
    expect(out).toContain("versão 2");
    expect(out).toContain('href="/cities?uf=SP"');
    expect(out).toContain('href="/graph?node=uf:SP"');
    expect(out).toContain('href="/graph?node=region:Sudeste"');
    expect(out).toContain('href="/graph?node=city:d0000000-0000-4000-8000-000000000001"'); // Explorar no grafo
    expect(out).toContain("645 cidades");
    expect(out).toContain("derivadas só das colunas da fonte");
  });
  it("sem página gerada: diz isso (e não inventa uma)", () => {
    const out = html(<CityDetailView loaded={ready(full({ page: undefined }))} />);
    expect(out).toContain("Nenhuma página gerada para esta cidade");
    expect(out).not.toContain("/generation/pages/");
  });
  it("sem a linha original: declara que não foi encontrada, sem inventar conteúdo", () => {
    const out = html(<CityDetailView loaded={ready(full({ record: undefined }))} />);
    expect(out).toContain("A linha original desta cidade não foi encontrada");
  });
  it("linha com problemas: lista os motivos", () => {
    const out = html(<CityDetailView loaded={ready(full({ record: { rowNumber: 3, raw: { name: "X" }, outcome: "duplicate", issues: [{ field: "ibge_code", code: "duplicate", severity: "error", message: "código repetido" }], entityId: null } }))} />);
    expect(out).toContain("Duplicada");
    expect(out).toContain("código repetido");
  });
  it("campos ausentes aparecem como 'não informado', nunca como zero nem valor inventado", () => {
    const base = full().detail!;
    const out = html(<CityDetailView loaded={ready<CityDetailData>({ detail: { ...base, city: { ...base.city, population: null, populationYear: null, region: null }, relations: { ...base.relations, region: undefined } } })} />);
    expect(out).toContain("não informado");
    expect(out).not.toContain(">0<");
  });
  it("origem de teste ou manual nunca é apresentada como real", () => {
    const base = full().detail!;
    const out = html(<CityDetailView loaded={ready<CityDetailData>({ detail: { ...base, source: { ...base.source, origin: "test" } } })} />);
    expect(out).toContain("Teste");
    expect(out).not.toMatch(/Origem real/);
  });
  it("cidade inexistente ou de outro workspace: 'não encontrada', sem vazar", () => {
    const out = html(<CityDetailView loaded={ready<CityDetailData>({ detail: undefined })} />);
    expect(out).toContain("Cidade não encontrada");
    expect(out).toContain("não existe neste workspace");
  });
  it("estados de bloqueio também no detalhe", () => {
    expect(html(<CityDetailView loaded={{ state: "db_unavailable" }} />)).toContain("banco de dados não respondeu");
    expect(html(<CityDetailView loaded={{ state: "unauthenticated" }} />)).toContain("Sessão não encontrada");
  });
});
