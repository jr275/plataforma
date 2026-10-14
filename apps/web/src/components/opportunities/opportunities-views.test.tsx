import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { engine } from "@plataforma/api";
import { realEstateVertical } from "@plataforma/pack-real-estate";
import { devOpportunities } from "@/lib/dev-opportunity-fixture";
import { OPPORTUNITY_PAGE_SIZE, parseOpportunityParams, summarize } from "@/lib/server/opportunities";
import type { Loaded } from "@/lib/server/tenant-data";
import type { BlockedState } from "@/components/generation/state-panel";
import { OpportunitiesHomeView, opportunityHref } from "./opportunities-home-view";
import { BlueprintView } from "./blueprint-view";
import { OpportunityDetailView } from "./opportunity-detail-view";
import { RoadmapView } from "./roadmap-view";
import { ScoreConfigView } from "./score-config-view";
import { TrendsView } from "./trends-view";

// As telas são renderizadas com dados produzidos pelo MOTOR REAL sobre respostas REAIS capturadas das fontes (ver dev-opportunity-fixture): nada é digitado à mão.
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const origin = { kind: "local" as const, host: "socket local" };
const ready = <T,>(data: T): Loaded<T> => ({ state: "ready", data, origin });
const intents = realEstateVertical.intents.map((i) => ({ id: i.id, label: i.label }));
const stages = realEstateVertical.stages.map((s) => ({ id: s.id, label: s.label }));
const experiences = realEstateVertical.experiences.map((x) => ({ id: x.id, label: x.label }));
const P = parseOpportunityParams({});
const NO_EDITOR = { unavailable: "Editor indisponível neste teste." };
const EA = { save: async () => ({ ok: false as const, kind: "error" as const, message: "x" }), evaluate: async () => ({ ok: false as const, kind: "error" as const, message: "x" }), preview: async () => ({ ok: false as const, kind: "error" as const, message: "x" }) };
const VM = { name: realEstateVertical.name, language: realEstateVertical.language, country: realEstateVertical.country };
type Detail = Awaited<ReturnType<typeof devOpportunities>>["details"] extends Map<string, infer D> ? D : never;
const dd = (detail: Detail | null, blueprints: Parameters<typeof summarize>[1] = [], configs: { id: string; version: number; hash: string; config: typeof realEstateVertical.scoring; note: string | null; createdAt: Date }[] = []) => ready({ detail, configs, blueprints: [...blueprints], ...summarize(detail, blueprints) });
const BLOCKED: BlockedState[] = ["not_configured", "unauthenticated", "no_tenant", "not_migrated", "db_unavailable", "auth_unavailable", "error"];

async function listData() {
  const { rows, runs, evidence } = await devOpportunities();
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return { list: { total: rows.length, rows: rows.slice(0, OPPORTUNITY_PAGE_SIZE), byStatus }, runs, evidenceCount: evidence.length };
}

describe("lista de oportunidades", () => {
  it("mostra as hipóteses com estado, prioridade ROTULADA (parcial) e os três objetivos separados; nunca promete demanda", async () => {
    const out = html(<OpportunitiesHomeView loaded={ready(await listData())} params={P} pageSize={OPPORTUNITY_PAGE_SIZE} intents={intents} vertical={VM} />);
    expect(out).toContain("Hipóteses de crescimento");
    expect(out).toContain("Parcial");
    expect(out).not.toContain("Geral (3 objetivos)"); // sem demanda/SERP/concorrência a prioridade geral não existe
    expect(out).toContain("Ordenação exploratória");
    expect(out).toContain("não substitui os seis gates");
    expect(out).toContain("Dimensão desconhecida não é evidência negativa");
    expect(out).toContain("Objetivos");
    expect(out).toContain("Cobertura");
    expect(out).toContain('aria-label="Valor comercial:'); // os três objetivos lado a lado; vazio = não medido
    expect(out).toMatch(/\d+\/15 · \d+%/);
    expect(out).toContain('href="/opportunities/00000000-0000-4000-8000-');
    expect(out).toContain("Iniciar pesquisa");
    expect(out).toMatch(/Mostrando 1 a 25 de \d+/);
  });
  it("sem nenhuma oportunidade: estado vazio com o próximo passo (não uma lista vazia muda)", () => {
    const out = html(<OpportunitiesHomeView loaded={ready({ list: { total: 0, rows: [], byStatus: {} }, runs: [], evidenceCount: 0 })} params={P} pageSize={25} intents={intents} vertical={VM} />);
    expect(out).toContain("Nenhuma oportunidade ainda");
    expect(out).toContain("Nenhuma pesquisa executada");
  });
  it("filtro sem resultado e página fora do intervalo têm mensagens próprias", () => {
    const f = parseOpportunityParams({ q: "zzz" });
    expect(html(<OpportunitiesHomeView loaded={ready({ list: { total: 0, rows: [], byStatus: { scored: 3 } }, runs: [], evidenceCount: 0 })} params={f} pageSize={25} intents={intents} vertical={VM} />)).toContain("Nenhuma oportunidade com esses filtros");
    const far = parseOpportunityParams({ page: "9" });
    expect(html(<OpportunitiesHomeView loaded={ready({ list: { total: 30, rows: [], byStatus: {} }, runs: [], evidenceCount: 0 })} params={far} pageSize={25} intents={intents} vertical={VM} />)).toContain("Esta página de resultados não existe");
  });
  for (const s of BLOCKED) {
    it(`estado '${s}': explica o motivo e não mostra nenhum dado`, () => {
      const loaded = (s === "not_configured" ? { state: s, missing: "banco de dados" } : { state: s }) as Loaded<never>;
      const out = html(<OpportunitiesHomeView loaded={loaded} params={P} pageSize={25} intents={intents} vertical={VM} />);
      expect(out).toContain("Estado");
      expect(out).not.toContain("Iniciar pesquisa");
      expect(out).not.toContain("<table");
    });
  }
  it("a URL é o estado: o link de paginação preserva filtros e omite os padrões", () => {
    expect(opportunityHref(P, {})).toBe("/opportunities");
    expect(opportunityHref(parseOpportunityParams({ status: "eligible", intent: "financing", sort: "recent", page: "2" }), { page: 3 })).toBe("/opportunities?status=eligible&intent=financing&sort=recent&page=3");
  });
});

describe("detalhe da oportunidade", () => {
  it("separa o que é fato, derivado e desconhecido; mostra score por objetivo, o que falta medir, evidência com URL e o histórico", async () => {
    const { details } = await devOpportunities();
    const d = [...details.values()].find((x) => x.evidence.length > 0 && x.entity !== null)!;
    const out = html(<OpportunityDetailView loaded={dd(d, [], [{ id: "c", version: 1, hash: "h", config: realEstateVertical.scoring, note: null, createdAt: new Date() }])} intents={intents} stages={stages} experiences={experiences} vertical={VM} />);
    expect(out).toContain("Hipótese");
    expect(out).toContain("Demanda de busca");
    expect(out).toContain("unavailable");
    for (const t of ["O que sei", "De onde sei", "O que falta", "O que bloqueia", "Próximo passo"]) expect(out).toContain(t);
    expect(out).toContain("não substitui os seis gates");
    expect(out).toContain("O que falta (");
    expect(out).toContain("Sem nota:"); // objetivo sem cobertura: sem nota, nunca zero
    expect(out).toMatch(/https:\/\/(api\.bcb\.gov\.br|agenciabrasil\.ebc\.com\.br|agenciadenoticias\.ibge\.gov\.br|servicodados\.ibge\.gov\.br)/);
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("Por que está aqui");
    expect(out).toContain("Histórico e decisões");
    expect(out).toContain("Recalcular");
    expect(out).not.toContain("{&quot;kind&quot;"); // penalidades legíveis, não JSON
    expect(out).not.toContain("consideration"); // rótulo do estágio, não o id interno
  });
  it("oferece só as decisões MANUAIS permitidas (aposentar, voltar a pontuada); nunca etapas que afirmam trabalho feito", async () => {
    const { details } = await devOpportunities();
    const d = [...details.values()].find((x) => x.status === "eligible")!;
    const out = html(<OpportunityDetailView loaded={dd(d, [], [])} intents={intents} stages={stages} experiences={experiences} vertical={VM} />);
    for (const s of engine.manualNext("eligible")) expect(out).toContain(`>${engine.STATE_LABEL[s]}</option>`);
    for (const s of ["serp_analyzed", "blueprinted", "published"] as const) expect(out).not.toContain(`>${engine.STATE_LABEL[s]}</option>`);
    expect(out).toContain("registradas pelo fluxo que as realiza");
  });
  it("mostra o rótulo da experiência da vertical, não o identificador interno", async () => {
    const { details } = await devOpportunities();
    const d = [...details.values()].find((x) => x.experience === "location_overview")!;
    const out = html(<OpportunityDetailView loaded={dd(d, [], [])} intents={intents} stages={stages} experiences={experiences} vertical={VM} />);
    expect(out).toContain("Visão geral da cidade");
  });
  it("oportunidade inexistente (ou de outro tenant): mensagem própria, sem dados", () => {
    const out = html(<OpportunityDetailView loaded={dd(null, [], [])} intents={intents} stages={stages} experiences={experiences} vertical={VM} />);
    expect(out).toContain("Oportunidade não encontrada");
    expect(out).not.toContain("demonstração");
  });
  for (const s of BLOCKED) it(`estado '${s}' no detalhe: explica o motivo`, () => {
    const loaded = (s === "not_configured" ? { state: s, missing: "x" } : { state: s }) as Loaded<never>;
    expect(html(<OpportunityDetailView loaded={loaded} intents={intents} stages={stages} experiences={experiences} vertical={VM} />)).toContain("Estado");
  });
});

describe("configuração do score", () => {
  it("sem versão gravada mostra o padrão da vertical, rotulado como tal, com todos os pesos editáveis", () => {
    const out = html(<ScoreConfigView loaded={ready({ configs: [] })} vertical={{ id: realEstateVertical.id, name: realEstateVertical.name, defaults: realEstateVertical.scoring }} />);
    expect(out).toContain("Ainda não há versão gravada");
    expect(out).toContain("Salvar como nova versão");
    for (const o of engine.OBJECTIVES) expect(out).toContain(`name="obj.${o}.weight"`);
    const dims = engine.OBJECTIVES.reduce((n, o) => n + Object.keys(realEstateVertical.scoring.objectives[o].dimensions).length, 0);
    expect((out.match(/name="dim\./g) ?? []).length).toBe(dims);
  });
});

describe("tendências e notícias", () => {
  it("lista registros reais com fonte, base, data, URL e limitações; declara as fontes bloqueadas", async () => {
    const { evidence, runs } = await devOpportunities();
    const out = html(<TrendsView loaded={ready({ evidence, runs })} filters={{ kind: "", adapter: "" }} vertical={VM} />);
    expect(out).toContain(">live<");
    expect(out).toMatch(/há \d+ dia\(s\)/);
    expect(out).toContain("Capacidades e fontes pendentes");
    expect(out).toContain("Aguardando credencial");
    expect(out).toContain("Banco Central (SGS)");
    expect(out).toContain("Capacidades e fontes pendentes");
    expect(out).toContain("Search Console");
    expect(out).toContain("Provedor de SERP");
    expect(out).toContain("Passaria a medir: Demanda");
    expect(out).toContain("não são volume de busca");
  });
  it("sem registros: estado vazio com o caminho para iniciar uma pesquisa", () => {
    expect(html(<TrendsView loaded={ready({ evidence: [], runs: [] })} filters={{ kind: "", adapter: "" }} vertical={VM} />)).toContain("Nenhum registro coletado ainda");
  });
});

describe("fronteira cliente/servidor", () => {
  it("componentes de cliente do motor NÃO importam @plataforma/api em tempo de execução (arrastaria o driver do banco para o navegador)", () => {
    const dir = path.resolve(__dirname);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".tsx") && !n.endsWith(".test.tsx"))) {
      const src = readFileSync(path.join(dir, f), "utf8");
      if (!/^"use client"/.test(src)) continue;
      for (const line of src.split("\n").filter((l) => /from "@plataforma\/api"/.test(l))) expect(line, `${f}: ${line}`).toMatch(/^import type /);
      for (const m of src.matchAll(/from "(\.\/[^"]+)"/g)) {
        const dep = path.join(dir, `${m[1]!.slice(2)}.ts`);
        let text = "";
        try { text = readFileSync(dep, "utf8"); } catch { continue; }
        for (const line of text.split("\n").filter((l) => /from "@plataforma\/api"/.test(l))) expect(line, `${f} -> ${m[1]}: ${line}`).toMatch(/^import type /);
      }
    }
  });
});

describe("blueprint na oportunidade (resumo) e na página de blueprint (completo)", () => {
  it("elegível sem blueprint: botão habilitado e estado vazio", async () => {
    const { details } = await devOpportunities();
    const d = [...details.values()].find((x) => x.status === "eligible" && !x.events.some((e) => e.type === "blueprint"))!;
    const out = html(<OpportunityDetailView loaded={dd(d, [])} intents={intents} stages={stages} experiences={experiences} vertical={VM} />);
    expect(out).toContain("Gerar blueprint");
    expect(out).toContain("Sem blueprint");
  });
  it("resumo na oportunidade: seis gates em uma linha, o link para o blueprint completo e a exceção de SERP vigente", async () => {
    const { details, blueprints } = await devOpportunities();
    const id = [...details.values()].find((x) => x.status === "blueprinted")!.id;
    const out = html(<OpportunityDetailView loaded={dd(details.get(id)!, blueprints.get(id)!)} intents={intents} stages={stages} experiences={experiences} vertical={VM} />);
    expect(out).toContain('aria-label="Resultado dos seis gates"');
    for (const g of ["Negócio", "Conhecimento", "Experiência", "Busca", "GEO", "Técnico"]) expect(out).toContain(g);
    expect(out).toContain(`href="/opportunities/${id}/blueprint"`);
    expect(out).toContain("Exceção de SERP vigente");
    expect(out).toContain("Não autoriza publicação");
    expect(out).toContain("Pronta para construir");
  });
  it("blueprint PRONTO ainda 'elegível': o próximo passo é a DECISÃO da exceção de SERP, com formulário habilitado e aviso de que não autoriza publicar", async () => {
    const { details, blueprints } = await devOpportunities();
    const id = [...blueprints.entries()].find(([k, v]) => v[0]!.ready && details.get(k)!.status === "eligible")![0];
    const out = html(<OpportunityDetailView loaded={dd(details.get(id)!, blueprints.get(id)!)} intents={intents} stages={stages} experiences={experiences} vertical={VM} />);
    expect(out).toContain("Registrar a exceção de SERP");
    expect(out).toContain("Etapa SERP pendente");
  });
  it("página do blueprint PRONTO: template real, seções, links internos, indexação, seis gates detalhados, prévia renderizada e decisão de publicação desabilitada", async () => {
    const { details, blueprints, previews } = await devOpportunities();
    const id = [...blueprints.entries()].find(([k, v]) => v[0]!.ready && details.get(k)!.status === "eligible")![0];
    const detail = details.get(id)!;
    const out = html(<BlueprintView loaded={ready({ detail, configs: [], blueprints: blueprints.get(id)!, preview: previews.get(id)!, editor: NO_EDITOR, ...summarize(detail, blueprints.get(id)!) })} vertical={VM} editorActions={EA} />);
    expect(out).toContain("city-overview v1");
    expect(out).toContain("Etapa SERP pendente: analisar com um provedor");
    // editor visual: sem o rascunho carregado (aqui indisponível), a tela diz o motivo em vez de um canvas vazio
    expect(out).toContain("editor visual da experiência da página");
    expect(out).toContain("Editor indisponível neste teste.");
    for (const g of ["negócio", "conhecimento"]) expect(out.toLowerCase()).toContain(g);
    expect((out.match(/data-gate="/g) ?? []).length).toBe(6);
    expect(out).toContain("Depende de: Provedor de SERP");
    expect(out).toContain("aguardando decisão de produto");
    expect(out).toContain("noindex até a publicação");
    expect(out).toContain("Links internos propostos");
    expect(out).toContain("destino ainda não existe");
    expect(out).toContain("Prévia da experiência");
    expect(out).toContain("Registrar exceção e avançar");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>[^<]*Publicar \(indisponível\)/);
    expect(out).toContain("nunca equivale a autorização");
    expect(out).toContain("Mecanismo de publicação");
  });
  it("página do blueprint com exceção vigente: motivo, autor, horário e pendência de revisão; sem formulário habilitado", async () => {
    const { details, blueprints, previews } = await devOpportunities();
    const id = [...details.values()].find((x) => x.status === "blueprinted")!.id;
    const detail = details.get(id)!;
    const out = html(<BlueprintView loaded={ready({ detail, configs: [], blueprints: blueprints.get(id)!, preview: previews.get(id)!, editor: NO_EDITOR, ...summarize(detail, blueprints.get(id)!) })} vertical={VM} editorActions={EA} />);
    expect(out).toContain("Exceção registrada");
    expect(out).toContain("nenhum provedor de SERP contratado");
    expect(out).toContain("Pendente de revisão. Não autoriza publicação");
    expect(out).toContain("exceção vigente");
  });
  it("página do blueprint BLOQUEADO: bloqueios exatos, sem prévia (nada simulado), exceção indisponível porque não resolve bloqueios", async () => {
    const { details, blueprints } = await devOpportunities();
    const id = [...blueprints.entries()].find(([, v]) => !v[0]!.ready)![0];
    const detail = details.get(id)!;
    const out = html(<BlueprintView loaded={ready({ detail, configs: [], blueprints: blueprints.get(id)!, preview: null, editor: NO_EDITOR, ...summarize(detail, blueprints.get(id)!) })} vertical={VM} editorActions={EA} />);
    expect(out).toContain("sem template");
    expect(out).toContain("Sem prévia");
    expect(out).toContain("Nenhuma foi inventada");
    expect(out).toContain("a exceção de SERP não resolve bloqueios");
    expect(out).not.toContain("Registrar a exceção de SERP");
  });
  it("sem blueprint, não encontrada e estados bloqueados na página do blueprint", async () => {
    const { details } = await devOpportunities();
    const d = [...details.values()].find((x) => x.status === "scored")!;
    expect(html(<BlueprintView loaded={ready({ detail: d, configs: [], blueprints: [], preview: null, editor: NO_EDITOR, ...summarize(d, []) })} vertical={VM} editorActions={EA} />)).toContain("Ainda não há blueprint");
    expect(html(<BlueprintView loaded={ready({ detail: null, configs: [], blueprints: [], preview: null, editor: NO_EDITOR, ...summarize(null, []) })} vertical={VM} editorActions={EA} />)).toContain("Oportunidade não encontrada");
    for (const s of BLOCKED) expect(html(<BlueprintView loaded={(s === "not_configured" ? { state: s, missing: "x" } : { state: s }) as Loaded<never>} vertical={VM} editorActions={EA} />)).toContain("Estado");
  });
  it("oportunidade que ainda não é elegível: botão de gerar desabilitado com a explicação", async () => {
    const { details } = await devOpportunities();
    const d = [...details.values()].find((x) => x.status === "scored")!;
    const out = html(<OpportunityDetailView loaded={dd(d, [])} intents={intents} stages={stages} experiences={experiences} vertical={VM} />);
    expect(out).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Gerar blueprint/);
    expect(out).toContain("só pode ser gerado para oportunidades elegíveis");
  });
});

describe("roadmap", () => {
  it("mostra as quatro faixas, soma os bloqueios (mais comuns primeiro) e liga cada oportunidade ao detalhe", async () => {
    const { roadmap } = await devOpportunities();
    const out = html(<RoadmapView loaded={ready(roadmap)} intents={intents} vertical={VM} />);
    for (const l of ["Pronta para construir", "Bloqueada", "Elegível, aguardando blueprint", "Ainda não elegível"]) expect(out).toContain(l);
    expect(out).toContain("O que mais bloqueia");
    expect(out).toContain("Sem demanda medida e sem justificativa estratégica");
    expect(out).toContain('href="/opportunities/00000000-0000-4000-8000-');
    expect(out).toContain("Prioridade é parcial");
    const counts = roadmap.blockers.map((b) => b.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(Object.values(roadmap.counts).reduce((a, b) => a + b, 0)).toBe(roadmap.total);
  });
  it("sem oportunidades pontuadas: estado vazio com o caminho; estados bloqueados explicam o motivo", () => {
    const empty = { byStatus: {}, counts: { ready: 0, blocked: 0, awaiting_blueprint: 0, needs_work: 0 }, items: { ready: [], blocked: [], awaiting_blueprint: [], needs_work: [] }, blockers: [], total: 0 };
    expect(html(<RoadmapView loaded={ready(empty)} intents={intents} vertical={VM} />)).toContain("Nenhuma oportunidade pontuada ainda");
    for (const s of BLOCKED) {
      const loaded = (s === "not_configured" ? { state: s, missing: "x" } : { state: s }) as Loaded<never>;
      const out = html(<RoadmapView loaded={loaded} intents={intents} vertical={VM} />);
      expect(out).toContain("Estado");
      expect(out).not.toContain("O que mais bloqueia");
    }
  });
});
