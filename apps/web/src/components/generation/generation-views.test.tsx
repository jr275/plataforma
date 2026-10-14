import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildCityFacts, renderCityPage, CITY_OVERVIEW, type City, type GateResult, type GenerationRunDetail, type ImportRunSummary, type PageDetail, type PageListItem, type PageVersionView } from "@plataforma/api";
import { parseHomeParams, parseVersionParam } from "@/lib/server/generation";
import type { Loaded } from "@/lib/server/tenant-data";
import { GenerationHomeView, homeHref, type HomeData } from "./generation-home-view";
import { PageDetailView, type PageDetailData } from "./page-detail-view";
import { RunDetailView } from "./run-detail-view";
import { StatePanel, type BlockedState } from "./state-panel";

// FIXTURES de teste: o conteúdo das páginas vem do MOTOR REAL (renderCityPage) aplicado a valores do IBGE (2026-10-12) usados só como
// entrada; os registros de lista e de execução são montados à mão e NÃO representam dados de produção.
const RUN: ImportRunSummary = { id: "c0000000-0000-4000-8000-000000000001", sourceName: "IBGE", fileName: "f.csv", fileSha256: "a".repeat(64), origin: "real", status: "succeeded", totalRows: 1, acceptedRows: 1, rejectedRows: 0, duplicateRows: 0, error: null, startedAt: new Date("2026-10-13T03:08:00Z"), finishedAt: new Date("2026-10-13T03:09:00Z"), createdBy: "t" };
const city = (over: Partial<City> = {}): City => ({ id: "d0000000-0000-4000-8000-000000000001", ibgeCode: "3550308", name: "São Paulo", uf: "SP", region: "Sudeste", population: 11911337, populationYear: 2026, sourceRunId: RUN.id, ...over });
function page(c: City) { const f = buildCityFacts(c, RUN); if (!f.ok) throw new Error(f.reason); const r = renderCityPage(CITY_OVERVIEW, f, { knownPaths: new Set() }); if (!r.ok) throw new Error(r.reason); return r.page; }
const pass = (gate: GateResult["gate"]): GateResult => ({ gate, outcome: "pass", detail: `ok ${gate}` });
const GATES: GateResult["gate"][] = ["required_fields", "url_unique", "url_stable", "metadata_valid", "links_resolve", "facts_traceable"];
const NOW = new Date("2026-11-01T12:00:00Z");
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const origin = { kind: "local" as const, host: "socket local" };
const ready = <T,>(data: T): Loaded<T> => ({ state: "ready", data, origin });

const listItem = (over: Partial<PageListItem> = {}): PageListItem => ({ id: "e0000000-0000-4000-8000-000000000001", entityId: "d0000000-0000-4000-8000-000000000001", path: "/cidades/sp/sao-paulo", status: "draft", latestVersion: 1, updatedAt: new Date("2026-10-13T03:10:00Z"), cityName: "São Paulo", uf: "SP", region: "Sudeste", population: 11911337, populationYear: 2026, ...over });
const homeData = (over: Partial<HomeData> = {}): HomeData => ({ pages: { rows: [listItem()], total: 1 }, runs: [], drafts: 1, blocked: 0, now: NOW, ...over });
const P = parseHomeParams({});

describe("parâmetros da URL (defensivos)", () => {
  it("valores fora da lista voltam ao padrão e o texto é limitado", () => {
    expect(parseHomeParams({})).toEqual({ q: "", status: "", uf: "", sort: "path", dir: "asc", page: 1 });
    const p = parseHomeParams({ q: "x".repeat(200), status: "published", uf: "zz", sort: "path; DROP TABLE", dir: "sideways", page: "-3" });
    expect(p).toEqual({ q: "x".repeat(80), status: "", uf: "", sort: "path", dir: "asc", page: 1 });
    expect(parseHomeParams({ status: "blocked", uf: "sp", sort: "population", dir: "desc", page: "3" })).toEqual({ q: "", status: "blocked", uf: "SP", sort: "population", dir: "desc", page: 3 });
    expect(parseHomeParams({ page: ["2", "3"] }).page).toBe(1); // arrays não são aceitos
  });
  it("homeHref preserva os filtros ao paginar e omite os padrões", () => {
    expect(homeHref(P, {})).toBe("/generation");
    expect(homeHref({ ...P, q: "campinas", status: "draft" }, { page: 2 })).toBe("/generation?q=campinas&status=draft&page=2");
  });
});

describe("parâmetro ?v= do detalhe (versão): estrito e explícito", () => {
  it("ausente ou vazio: sem versão pedida (mostra a mais recente, sem aviso)", () => {
    expect(parseVersionParam(undefined)).toEqual({ kind: "none" });
    expect(parseVersionParam("")).toEqual({ kind: "none" });
  });
  it("inteiro positivo em decimal simples: versão pedida", () => {
    for (const [raw, v] of [["1", 1], ["2", 2], ["99", 99], ["999999999", 999999999]] as const) expect(parseVersionParam(raw), raw).toEqual({ kind: "ok", version: v });
  });
  it("qualquer outra coisa PRESENTE é inválida (nada de aceitar '1abc' como 1 nem cair em silêncio na mais recente)", () => {
    for (const raw of ["0", "-3", "abc", "1abc", "01", "1.5", "1e3", " 2", "2 ", "+2", "0x10", "٣", "99999999999999999999", "1000000000", ["1", "2"], ["1"]]) {
      expect(parseVersionParam(raw as string | string[]), JSON.stringify(raw)).toEqual({ kind: "invalid" });
    }
  });
});

describe("estados em que a tela não pode mostrar dados", () => {
  const cases: [BlockedState, RegExp][] = [
    ["not_configured", /não está configurada/], ["unauthenticated", /Sessão não encontrada/], ["no_tenant", /não está associado a um workspace/],
    ["not_migrated", /As tabelas de geração ainda não existem neste banco[\s\S]*migrations 0005, 0006 e 0007 ainda não foram aplicadas/], ["error", /Não foi possível ler/],
    ["db_unavailable", /banco de dados não respondeu/], ["auth_unavailable", /não conseguimos verificar a sua sessão/i],
  ];
  for (const [state, text] of cases) {
    it(`${state}: explica o motivo e nunca simula dados`, () => {
      const out = html(<GenerationHomeView loaded={state === "not_configured" ? { state, missing: "banco" } : ({ state } as Loaded<HomeData>)} params={P} pageSize={20} />);
      expect(out).toMatch(text);
      expect(out).not.toMatch(/Exemplo Labs|Northgate/); // nenhum workspace fictício aparece
      expect(out).not.toContain("<table");
      expect(out).not.toMatch(/Gerar rascunhos/); // sem estado pronto não há como gerar
    });
  }
  it("a mensagem de erro não vaza detalhes do banco", () => {
    for (const st of ["error", "db_unavailable", "auth_unavailable"] as const) expect(html(<StatePanel state={st} />), st).not.toMatch(/postgres|host|password|connection|https?:/i);
  });
  it("infraestrutura fora do ar NÃO se parece com ausência de dados: nunca diz que não há páginas", () => {
    for (const st of ["error", "db_unavailable", "auth_unavailable"] as const) {
      const out = html(<GenerationHomeView loaded={{ state: st } as Loaded<HomeData>} params={P} pageSize={20} />);
      expect(out, st).not.toMatch(/Nenhuma página/);
      expect(out, st).toMatch(/Tente novamente|tente novamente|Tente de novo/);
    }
  });
});

describe("lista de páginas e formulário de geração", () => {
  it("vazio de verdade: orienta a gerar, e o formulário tem rótulos, as 27 UFs e o padrão 20", () => {
    const out = html(<GenerationHomeView loaded={ready(homeData({ pages: { rows: [], total: 0 }, drafts: 0 }))} params={P} pageSize={20} />);
    expect(out).toContain("Nenhuma página gerada ainda");
    expect(out).toContain('for="gen-uf"');
    expect(out).toContain('for="gen-limit"');
    expect((out.match(/<option value="[A-Z]{2}"/g) ?? []).length).toBeGreaterThanOrEqual(27);
    expect(out).toMatch(/name="limit"[^>]*value="20"|value="20"[^>]*name="limit"/);
    expect(out).toContain("Gerar rascunhos");
    expect(out).toContain("rascunho</strong>; nada é publicado");
  });
  it("com filtro e sem resultado: mensagem própria e link para limpar", () => {
    const out = html(<GenerationHomeView loaded={ready(homeData({ pages: { rows: [], total: 0 } }))} params={{ ...P, q: "zzz" }} pageSize={20} />);
    expect(out).toContain("Nenhuma página com esses filtros");
    expect(out).toContain('href="/generation"');
  });
  it("com dados: tabela acessível, link para o detalhe, status em texto, paginação preservando filtros", () => {
    const rows = [listItem(), listItem({ id: "e0000000-0000-4000-8000-000000000002", cityName: "Guarulhos", path: "/cidades/sp/guarulhos", status: "blocked", latestVersion: 2, population: null })];
    const out = html(<GenerationHomeView loaded={ready(homeData({ pages: { rows, total: 45 }, drafts: 1, blocked: 1 }))} params={{ ...P, q: "a", page: 2 }} pageSize={20} />);
    expect(out).toContain('<caption class="sr-only">Páginas geradas</caption>');
    expect(out).toContain('scope="col"');
    expect(out).toContain('href="/generation/pages/e0000000-0000-4000-8000-000000000001"');
    expect(out).toContain("Rascunho");
    expect(out).toContain("Bloqueada");
    expect(out).toContain("—"); // população ausente aparece como traço, não como zero
    expect(out).toContain("Mostrando 21 a 40 de 45");
    expect(out).toContain('href="/generation?q=a"'); // anterior (página 1)
    expect(out).toContain('href="/generation?q=a&amp;page=3"'); // próxima
    expect(out).toContain("Banco: local (ambiente de desenvolvimento)");
    expect(out).toContain("Fonte dos fatos: IBGE (origem real)");
  });
  it("página fora do intervalo (há dados, mas esta página não existe): NÃO diz 'nenhuma página gerada' e leva à primeira e à última", () => {
    const out = html(<GenerationHomeView loaded={ready(homeData({ pages: { rows: [], total: 45 }, drafts: 45 }))} params={{ ...P, q: "", page: 9 }} pageSize={20} />);
    expect(out).not.toContain("Nenhuma página gerada ainda");
    expect(out).not.toContain("Nenhuma página com esses filtros");
    expect(out).toContain("Esta página de resultados não existe");
    expect(out).toContain("45 página(s)");
    expect(out).toContain('href="/generation"'); // primeira página
    expect(out).toContain('href="/generation?page=3"'); // última: ceil(45/20) = 3
    expect(out).not.toMatch(/Mostrando 161 a/); // sem faixa de itens impossível
  });
  it("fora do intervalo preservando os filtros nos links", () => {
    const out = html(<GenerationHomeView loaded={ready(homeData({ pages: { rows: [], total: 21 } }))} params={{ ...P, q: "campinas", status: "draft", page: 5 }} pageSize={20} />);
    expect(out).toContain('href="/generation?q=campinas&amp;status=draft&amp;page=2"');
  });
  it("na última página, 'Próxima' não é link", () => {
    const out = html(<GenerationHomeView loaded={ready(homeData({ pages: { rows: [listItem()], total: 1 } }))} params={P} pageSize={20} />);
    expect(out).toContain('aria-disabled="true">Próxima');
  });
});

describe("detalhe da página: pré-visualização, gates, fatos e ações", () => {
  const versions = (c: City): PageVersionView[] => [2, 1].map((n) => ({ id: `v${n}`, version: n, runId: RUN.id, contentHash: String(n).repeat(64).slice(0, 64), content: page(c), templateKey: "city-overview", templateVersion: 1, createdAt: new Date("2026-10-13T03:10:00Z") }));
  const detail = (over: Partial<PageDetail> = {}, c: City = city()): PageDetailData => ({ detail: { page: listItem({ latestVersion: 2 }), versions: versions(c), latestAttempt: { runId: RUN.id, startedAt: new Date("2026-10-13T03:10:00Z"), outcome: "generated", gates: GATES.map(pass), error: null }, ...over }, now: NOW });

  it("mostra a página renderizada (h1, seções, fontes), a prévia de busca e o selo 'Não publicada'", () => {
    const out = html(<PageDetailView loaded={ready(detail())} />);
    expect(out).toContain('data-testid="rendered-article"');
    expect(out).toContain("São Paulo, SP");
    expect(out).toContain("Segundo a estimativa do IBGE para 2026");
    expect(out).toContain("Fonte dos dados");
    expect(out).toContain("São Paulo (SP): população e localização"); // SERP
    expect(out).toContain("Não publicada");
    expect(out).toContain("não está publicada");
    expect(out).toContain('aria-pressed="true"'); // alternância desktop/celular
    expect(out).toContain("Celular");
  });
  it("'Aprovar e publicar' fica DESABILITADO com o motivo explícito; nada simula sucesso", () => {
    const out = html(<PageDetailView loaded={ready(detail())} />);
    // Isola o elemento <button> do botão e olha só os ATRIBUTOS (sem o class, que traz variantes "disabled:" do estilo).
    const tag = out.split("<button").find((b) => b.includes("Aprovar e publicar"))!;
    const attrs = tag.slice(0, tag.indexOf(">")).replace(/class="[^"]*"/, "");
    expect(attrs).toMatch(/\bdisabled\b/);
    expect(attrs).toContain('aria-disabled="true"');
    expect(out).toContain("Indisponível: a publicação (etapa 5) ainda não existe");
    expect(out).not.toMatch(/publicada com sucesso|Publicado em/i);
    expect(out).toContain("Reprocessar");
  });
  it("lista os seis gates, cada um com o próprio resultado e o motivo", () => {
    const out = html(<PageDetailView loaded={ready(detail())} />);
    for (const g of GATES) expect(out).toContain(`ok ${g}`);
    expect((out.match(/Passou/g) ?? []).length).toBe(6);
    expect(out).toContain("URL única no workspace");
  });
  it("página bloqueada: alerta com o gate reprovado e orientação, mantendo a última versão visível", () => {
    const failing: GateResult[] = GATES.map((g) => (g === "url_unique" ? { gate: g, outcome: "fail", detail: "o caminho já pertence a outra entidade" } : g === "required_fields" ? pass(g) : { gate: g, outcome: "skipped", detail: "sem conteúdo para avaliar" }));
    const out = html(<PageDetailView loaded={ready(detail({ page: listItem({ status: "blocked", latestVersion: 2 }), latestAttempt: { runId: RUN.id, startedAt: new Date("2026-10-13T03:10:00Z"), outcome: "blocked", gates: failing, error: null } }))} />);
    expect(out).toContain('role="alert"');
    expect(out).toContain("bloqueada na última tentativa");
    expect(out).toContain("o caminho já pertence a outra entidade");
    expect(out).toContain("Reprovou");
    expect(out).toContain("Não avaliado");
    expect(out).toContain('data-testid="rendered-article"');
  });
  it("fato ausente: a seção omitida é explicada; população ausente aparece como seção omitida, nunca inventada", () => {
    const c = city({ population: null, populationYear: null });
    const out = html(<PageDetailView loaded={ready(detail({ page: listItem({ population: null }), versions: versions(c) }, c))} />);
    expect(out).toContain("Seção omitida");
    expect(out).toMatch(/faltam: População estimada, Ano da estimativa/);
    expect(out).not.toContain("habitantes");
  });
  it("dados antigos: marca 'Revisar' só acima do limite explícito (aviso, não gate)", () => {
    const fresh = html(<PageDetailView loaded={ready(detail())} />);
    expect(fresh).not.toContain("Revisar:");
    const old = html(<PageDetailView loaded={ready({ ...detail(), now: new Date("2028-01-01T00:00:00Z") })} />);
    expect(old).toContain("Revisar:");
  });
  it("histórico de versões: lista todas, preserva as antigas e permite abrir uma antiga com aviso", () => {
    const out = html(<PageDetailView loaded={ready(detail())} />);
    expect(out).toContain("Versão 2");
    expect(out).toContain("Versão 1");
    expect(out).toContain("mais recente");
    expect(out).toContain('href="/generation/pages/e0000000-0000-4000-8000-000000000001?v=1"');
    const old = html(<PageDetailView loaded={ready(detail())} version={1} />);
    expect(old).toContain("Você está vendo a <strong>versão 1</strong>");
    expect(old).toContain("em exibição");
  });
  it("versão pedida que não existe: avisa em vez de mostrar a mais recente como se fosse a pedida", () => {
    const out = html(<PageDetailView loaded={ready(detail())} version={99} />);
    expect(out).toContain("A versão 99 não existe");
    expect(out).toContain("mostrando a mais recente");
    expect(html(<PageDetailView loaded={ready(detail())} version={1} />)).not.toContain("não existe para esta página");
    expect(html(<PageDetailView loaded={ready(detail())} />)).not.toContain("não existe para esta página");
  });
  it("parâmetro de versão inválido: avisa explicitamente e mostra a mais recente; versão válida existente não gera aviso nenhum", () => {
    const bad = html(<PageDetailView loaded={ready(detail())} invalidVersion />);
    expect(bad).toContain("O parâmetro de versão da URL é inválido");
    expect(bad).toContain("mostrando a mais recente (versão 2)");
    expect(bad).not.toContain("Você está vendo a <strong>");
    const good = html(<PageDetailView loaded={ready(detail())} version={1} />);
    expect(good).not.toContain("parâmetro de versão");
    expect(good).not.toContain("não existe para esta página");
    expect(html(<PageDetailView loaded={ready(detail())} />)).not.toContain("parâmetro de versão");
  });
  it("sem nenhuma versão, o aviso de parâmetro inválido não aparece (não há 'mais recente' a mostrar)", () => {
    expect(html(<PageDetailView loaded={ready(detail({ versions: [] }))} invalidVersion />)).not.toContain("parâmetro de versão");
  });
  it("campos editáveis e dados estruturados: declara o que NÃO existe, sem fingir", () => {
    const out = html(<PageDetailView loaded={ready(detail())} />);
    expect(out).toContain("Campos editáveis");
    expect(out).toContain("Nenhum. O template");
    expect(out).toContain("Não gerados. JSON-LD e sitemap");
  });
  it("sem versão aprovada, não inventa pré-visualização", () => {
    const out = html(<PageDetailView loaded={ready(detail({ versions: [] }))} />);
    expect(out).toContain("ainda não tem versão aprovada");
    expect(out).not.toContain('data-testid="rendered-article"');
  });
  it("página inexistente ou de outro workspace: 'não encontrada', sem vazar", () => {
    const out = html(<PageDetailView loaded={ready<PageDetailData>({ detail: undefined, now: NOW })} />);
    expect(out).toContain("Página não encontrada");
    expect(out).toContain("não existe neste workspace");
  });
  it("estados de bloqueio também no detalhe", () => {
    expect(html(<PageDetailView loaded={{ state: "not_migrated" }} />)).toContain("migrations 0005, 0006 e 0007");
    expect(html(<PageDetailView loaded={{ state: "unauthenticated" }} />)).toContain("Sessão não encontrada");
  });
});

describe("detalhe da execução", () => {
  const run = (over: Partial<GenerationRunDetail> = {}): GenerationRunDetail => ({
    run: { id: "r1", templateKey: "city-overview", templateVersion: 1, status: "partial", totalItems: 3, generatedItems: 1, unchangedItems: 1, blockedItems: 1, error: null, startedAt: new Date("2026-10-13T03:10:00Z"), finishedAt: new Date("2026-10-13T03:11:00Z"), createdBy: "u" },
    scope: { uf: "SP", limit: 3 },
    items: [
      { entityId: "a", outcome: "generated", gates: GATES.map(pass), pageId: "p1", pageVersionId: "v1", error: null, ibgeCode: "3509502", cityName: "Campinas", uf: "SP", pagePath: "/cidades/sp/campinas" },
      { entityId: "b", outcome: "unchanged", gates: GATES.map(pass), pageId: "p2", pageVersionId: "v2", error: null, ibgeCode: "3518800", cityName: "Guarulhos", uf: "SP", pagePath: "/cidades/sp/guarulhos" },
      { entityId: "c", outcome: "blocked", gates: GATES.map((g) => (g === "required_fields" ? { gate: g, outcome: "fail" as const, detail: "origem ou execução inválida: origin_not_real" } : { gate: g, outcome: "skipped" as const, detail: "sem conteúdo para avaliar" })), pageId: null, pageVersionId: null, error: null, ibgeCode: "3599998", cityName: "Cidade de Teste", uf: "SP", pagePath: null },
    ],
    ...over,
  });
  it("mostra contagens, resultado por cidade, links para as páginas e o motivo de cada bloqueio", () => {
    const out = html(<RunDetailView loaded={ready<GenerationRunDetail | undefined>(run())} />);
    expect(out).toContain("Parcial");
    expect(out).toContain('href="/generation/pages/p1"');
    expect(out).toContain("Conteúdo idêntico ao da última versão.");
    expect(out).toContain("Campos obrigatórios e origem real:");
    expect(out).toContain("origin_not_real");
    expect(out).toContain('<caption class="sr-only">Resultado por cidade</caption>');
    expect(out).not.toContain('href="/generation/pages/null"'); // cidade bloqueada sem página não vira link quebrado
  });
  it("execução inexistente, com erro e sem itens", () => {
    expect(html(<RunDetailView loaded={ready<GenerationRunDetail | undefined>(undefined)} />)).toContain("Execução não encontrada");
    const failed = run({ items: [], run: { ...run().run, status: "failed", error: "falha injetada" } });
    const out = html(<RunDetailView loaded={ready<GenerationRunDetail | undefined>(failed)} />);
    expect(out).toContain('role="alert"');
    expect(out).toContain("falha injetada");
    expect(out).toContain("não gravou itens");
  });
});
