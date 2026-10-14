import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { graph } from "@plataforma/api";
import { graphHref, loadGraphWorkspace, parseGraphParams, type GraphWorkspaceData } from "@/lib/server/graph";
import type { Loaded } from "@/lib/server/tenant-data";
import type { BlockedState } from "@/components/generation/state-panel";
import { AgentPanel } from "./agent-panel";
import { AgentThread } from "./agent-thread";
import { GraphInspector } from "./inspector";
import { GraphWorkspace } from "./graph-workspace";
import { verificationOf } from "./kinds";

// DADOS SINTÉTICOS DE TESTE (origem "test"). O leitor e a montagem de nós e relações são os REAIS; o armazenamento é em memória.
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const NOW = new Date("2026-11-01T12:00:00Z");
const SRC: graph.StoreSource = { runId: "c0000000-0000-4000-8000-000000000001", sourceName: "fonte-de-teste", origin: "test", fileName: "t.csv", fileSha256: "ab".repeat(32), status: "succeeded", importedAt: new Date("2026-10-12T20:00:00Z"), totalRows: 4, acceptedRows: 4 };
const city = (n: number, name: string, uf: string, region: string | null, pop: number | null): graph.StoreCity => ({ id: `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, ibgeCode: String(3500000 + n), name, uf, region, population: pop, populationYear: pop === null ? null : 2026, sourceRunId: SRC.runId });
const CITIES = [city(1, "Alfa", "SP", "Sudeste", 500), city(2, "Beta", "SP", "Sudeste", 900), city(3, "Gama", "SP", "Sudeste", null), city(4, "Delta", "RJ", "Sudeste", 700)];
const PAGE = { id: "e0000000-0000-4000-8000-000000000001", path: "/cidades/sp/beta", status: "draft" as const, latestVersion: 2, updatedAt: new Date("2026-10-13T03:10:00Z") };
const reader = () => graph.createGraphReader(graph.createMemoryGraphStore({ cities: CITIES, sources: [SRC], pages: [{ page: PAGE, cityId: CITIES[1]!.id }] }));
const ready = (data: GraphWorkspaceData): Loaded<GraphWorkspaceData> => ({ state: "ready", data, origin: { kind: "local", host: "socket local" } });
const build = async (raw: Record<string, string>) => { const params = parseGraphParams(raw); return { params, loaded: ready(await loadGraphWorkspace(reader(), params, NOW)) }; };
// Os atributos do <button> saem em ordem própria do React (value antes de name): confere o par sem depender da ordem.
const tool = (out: string, id: string) => new RegExp(`<button[^>]*(?=[^>]*name="tool")(?=[^>]*value="${id}")[^>]*>`).test(out);
const render = async (raw: Record<string, string>) => { const { params, loaded } = await build(raw); return html(<GraphWorkspace loaded={loaded} params={params} />); };

describe("estados em que o grafo não pode mostrar dados", () => {
  const states: [BlockedState, RegExp][] = [["not_configured", /não está configurada/], ["unauthenticated", /Sessão não encontrada/], ["no_tenant", /não está associado/], ["not_migrated", /migrations/], ["db_unavailable", /banco de dados não respondeu/], ["auth_unavailable", /não conseguimos verificar a sua sessão/i], ["error", /Não foi possível ler/]];
  for (const [state, text] of states) {
    it(`${state}: explica o motivo; nunca desenha grafo, inspetor nem painel de investigação`, () => {
      const out = html(<GraphWorkspace loaded={state === "not_configured" ? { state, missing: "banco" } : ({ state } as Loaded<GraphWorkspaceData>)} params={parseGraphParams({})} />);
      expect(out).toMatch(text);
      expect(out).not.toContain('data-testid="graph-canvas"');
      expect(out).not.toContain('data-testid="inspector"');
      expect(out).not.toContain('data-testid="agent-panel"');
    });
  }
});

describe("workspace: início, busca e filtros", () => {
  it("início: pontos de partida reais, convite para explorar, sem inspetor nem investigação", async () => {
    const out = await render({});
    expect(out).toContain("Pontos de partida");
    expect(out).toContain("Sudeste");
    expect(out).toContain("Escolha uma entidade para começar");
    expect(out).toContain("Nenhuma entidade selecionada");
    expect(out).not.toContain('data-testid="agent-panel"');
  });
  it("sem dados importados: estado vazio verdadeiro, com o caminho para importar", async () => {
    const params = parseGraphParams({});
    const out = html(<GraphWorkspace loaded={ready({ detail: undefined, expansion: undefined, nodeMissing: false, search: undefined, starters: [], now: NOW })} params={params} />);
    expect(out).toContain("Nenhuma entidade importada ainda");
    expect(out).toContain('href="/data-flow"');
  });
  it("busca: resultados com tipo e link para o nó; formulário com rótulos, tipos e a seleção preservada", async () => {
    const out = await render({ q: "alf", node: "uf:SP" });
    expect(out).toContain('role="search"');
    expect(out).toContain("Tipos de entidade");
    expect(out).toContain('name="node" value="uf:SP"');
    expect(out).toContain(`href="/graph?node=city%3A${CITIES[0]!.id}&amp;q=alf"`);
    expect(out).toContain("Alfa");
  });
  it("busca sem resultado: mensagem própria", async () => {
    expect(await render({ q: "zzz" })).toContain("Nada encontrado");
  });
  it("nó inexistente (ou de outro workspace): estado próprio, sem inspetor", async () => {
    const out = await render({ node: "uf:AC" });
    expect(out).toContain("Esta entidade não existe neste workspace");
    expect(out).not.toContain('data-testid="inspector"');
  });
});

describe("workspace: vizinhança, relações e navegação", () => {
  it("UF: o canvas liga ao detalhe de cada vizinho (link por nó, com os filtros preservados) e marca o selecionado", async () => {
    const out = await render({ node: "uf:SP", q: "x" });
    expect(out).toContain('data-testid="graph-canvas"');
    expect(out).toContain('aria-current="true"');
    for (const c of CITIES.slice(0, 3)) expect(out).toContain(`href="/graph?node=city%3A${c.id}&amp;q=x"`); // cidades de SP
    expect(out).toContain('href="/graph?node=region%3ASudeste&amp;q=x"');
    expect(out).not.toContain(CITIES[3]!.id); // Delta é do RJ: não é vizinho de SP
  });
  it("a lista de relações é o equivalente acessível do desenho: direção, tipo e base de cada relação", async () => {
    const out = await render({ node: "uf:SP" });
    expect(out).toContain('<caption class="sr-only">Relações da entidade selecionada</caption>');
    expect(out).toContain("pertence à UF");
    expect(out).toContain("está na região");
    expect(out).toContain("coluna da fonte");
  });
  it("cidade com página: relação 'tem a página' com a base 'vínculo gravado'; sem página: nenhum nó de página", async () => {
    const withPage = await render({ node: `city:${CITIES[1]!.id}` });
    expect(withPage).toContain("tem a página");
    expect(withPage).toContain("vínculo gravado");
    expect(withPage).toContain("/cidades/sp/beta");
    const without = await render({ node: `city:${CITIES[0]!.id}` });
    expect(without).not.toContain("tem a página");
  });
  it("filtro por tipo: só os tipos pedidos viram vizinhos; as caixas refletem o filtro", async () => {
    const out = await render({ node: "uf:SP", kinds: "region" });
    expect(out).not.toContain(`node=city%3A${CITIES[0]!.id}`);
    expect(out).toContain("region%3ASudeste");
    const box = (k: string) => out.match(new RegExp(`<input[^>]*name="kinds"[^>]*value="${k}"[^>]*>`))![0];
    expect(box("region")).toContain("checked");
    expect(box("city")).not.toContain("checked");
  });
  it("grande vizinhança: avisa o recorte e oferece 'mostrar mais'; no teto, explica e leva à lista", async () => {
    const many = Array.from({ length: 60 }, (_, i) => city(100 + i, `Cidade ${i}`, "SP", "Sudeste", 1000 + i));
    const r = graph.createGraphReader(graph.createMemoryGraphStore({ cities: many, sources: [SRC] }));
    const p1 = parseGraphParams({ node: "uf:SP" });
    const out = html(<GraphWorkspace loaded={ready(await loadGraphWorkspace(r, p1, NOW))} params={p1} />);
    expect(out).toContain("Mostrando 24 de 60 cidades");
    expect(out).toContain('href="/graph?node=uf%3ASP&amp;limit=48"');
    expect(out).toContain('href="/cities?uf=SP"');
    expect(out).not.toContain("Rótulos só nas 24 maiores"); // com 24 cidades todas têm rótulo
    const p48 = parseGraphParams({ node: "uf:SP", limit: "48" });
    expect(html(<GraphWorkspace loaded={ready(await loadGraphWorkspace(r, p48, NOW))} params={p48} />)).toContain("Rótulos só nas 24 maiores"); // com 48, só as 24 primeiras
    const huge = Array.from({ length: 120 }, (_, i) => city(300 + i, `C${i}`, "SP", "Sudeste", 1000 + i));
    const p2 = parseGraphParams({ node: "uf:SP", limit: "96" });
    const out2 = html(<GraphWorkspace loaded={ready(await loadGraphWorkspace(graph.createGraphReader(graph.createMemoryGraphStore({ cities: huge, sources: [SRC] })), p2, NOW))} params={p2} />);
    expect(out2).toContain("Mostrando 96 de 120 cidades");
    expect(out2).toContain("Limite de 96 atingido");
    expect(out2).not.toContain("Mostrar mais");
  });
  it("o canvas descreve o que mostra (acessibilidade) e cada nó tem rótulo com tipo e nome", async () => {
    const out = await render({ node: "uf:SP" });
    expect(out).toContain('role="img"');
    expect(out).toContain("Vizinhança de SP");
    expect(out).toContain('aria-label="Cidade Alfa, SP · 3500001"');
  });
});

describe("inspetor: fato, derivado e sugestão são distintos; origem e atualidade visíveis", () => {
  const detail = async (ref: string) => (await reader().node(ref))!;
  it("cidade: atributos da fonte como 'Fato da fonte'; origem de TESTE dita como teste; atualidade em dias; linha original", async () => {
    const out = html(<GraphInspector detail={await detail(`city:${CITIES[0]!.id}`)} now={NOW} />);
    expect(out).toContain("Fato da fonte");
    expect(out).toContain(CITIES[0]!.id);
    expect(out).toContain("Origem de teste: não representa dado real");
    expect(out).toContain("há 19 dia(s)");
    expect(out).toContain("sha256 abababababababab");
    expect(out).toContain("/data-flow?run=");
    expect(out).toContain("Detalhe da cidade");
  });
  it("UF: contagens como 'Derivado'; a sugestão aparece SEPARADA, rotulada 'Sugestão'", async () => {
    const out = html(<GraphInspector detail={await detail("uf:SP")} now={NOW} />);
    expect(out).toContain("Derivado");
    expect(out).toContain('aria-label="Sugestões"');
    expect(out).toContain("Sugestão");
    expect(out).toContain("Este painel não exibe inferências");
  });
  it("valores ausentes aparecem como 'não informado', nunca como zero", async () => {
    const out = html(<GraphInspector detail={await detail(`city:${CITIES[2]!.id}`)} now={NOW} />);
    expect(out).toContain("não informado");
  });
  it("verificação da origem: só 'real' + concluída é dita verificada", () => {
    expect(verificationOf({ origin: "real", status: "succeeded" }).label).toContain("Origem real · execução concluída");
    expect(verificationOf({ origin: "real", status: "partial" }).tone).toBe("warning");
    expect(verificationOf({ origin: "real", status: "failed" }).tone).toBe("danger");
    expect(verificationOf({ origin: "test", status: "succeeded" }).label).toContain("teste");
    expect(verificationOf({ origin: "manual", status: "succeeded" }).label).toContain("manual");
  });
});

describe("painel de investigação: ferramentas reais, sem simular agente", () => {
  it("rotula o que é: ferramentas reais, somente leitura, sem modelo de linguagem e sem CopilotKit/AG-UI; texto livre desabilitado", () => {
    const out = html(<AgentPanel nodeRef="uf:SP" nodeLabel="SP" tools={[{ id: "describe_entity", label: "Descrever a entidade" }, { id: "top_cities", label: "Maiores cidades por população" }]} />);
    expect(out).toContain('data-testid="agent-panel"');
    expect(out).toContain("Ferramentas reais");
    expect(out).toContain("somente leitura");
    expect(out).toContain("Nenhum modelo de linguagem está conectado");
    expect(out).toContain("CopilotKit/AG-UI não estão instalados");
    expect(out).toMatch(/<textarea[^>]*disabled/);
    expect(out).toContain('name="node" value="uf:SP"');
    expect(tool(out, "describe_entity")).toBe(true);
    expect(tool(out, "top_cities")).toBe(true);
    expect(out).not.toMatch(/Resposta do agente|pensando|assistente/i); // nada de fala simulada
  });
  it("o workspace só oferece as ferramentas aplicáveis ao tipo da entidade", async () => {
    const uf = await render({ node: "uf:SP" });
    expect(tool(uf, "top_cities")).toBe(true);
    const cityOut = await render({ node: `city:${CITIES[0]!.id}` });
    expect(tool(cityOut, "top_cities")).toBe(false);
    expect(tool(cityOut, "check_generation")).toBe(true);
  });
  it("thread: passos, achados com a natureza de cada valor e citações INTERNAS; links externos nunca viram link", () => {
    const run: graph.GraphToolResult = {
      tool: "trace_source", ref: "uf:SP", ok: true, title: "Rastrear a origem e a atualidade", error: null,
      steps: [{ label: "Entidade lida: SP", status: "done" }, { label: "Falhou aqui", status: "failed" }],
      findings: [{ label: "Fonte", value: "IBGE", basis: "fact", href: "/data-flow?run=x" }, { label: "Importado em", value: "12/10/2026", basis: "derived", href: null }, { label: "Sugestão", value: "Gerar", basis: "suggestion", href: "https://evil.example/x" }],
      citations: [{ label: "Execução", href: "/data-flow?run=x" }, { label: "Externa", href: "https://evil.example/y" }],
    };
    const out = html(<AgentThread runs={[run]} pending={false} />);
    expect(out).toContain("Concluída");
    expect(out).toContain("somente leitura");
    expect(out).toContain("Fato da fonte");
    expect(out).toContain("Derivado");
    expect(out).toContain("Sugestão");
    expect(out).toContain('href="/data-flow?run=x"');
    expect(out).not.toContain("evil.example"); // nenhum link externo é renderizado como link
    expect(out).toContain("(feito)");
    expect(out).toContain("(falhou)");
  });
  it("thread: falha aparece como falha, com a mensagem; execução em andamento é anunciada", () => {
    const out = html(<AgentThread runs={[{ tool: "describe_entity", ref: "uf:AC", ok: false, title: "Descrever a entidade", steps: [{ label: "A entidade não existe neste workspace.", status: "failed" }], findings: [], citations: [], error: "A entidade não existe neste workspace." }]} pending />);
    expect(out).toContain("Falhou");
    expect(out).toContain('role="alert"');
    expect(out).toContain("Executando a ferramenta");
    expect(out).toContain('aria-busy="true"');
  });
});

describe("hrefs entre nós", () => {
  it("graphHref é a única fonte dos links: trocar de nó mantém busca e filtros", () => {
    const p = parseGraphParams({ q: "sp", kinds: "uf,city", limit: "48" });
    expect(graphHref(p, { node: "uf:SP", limit: 24 })).toBe("/graph?node=uf%3ASP&q=sp&kinds=uf%2Ccity");
  });
});
