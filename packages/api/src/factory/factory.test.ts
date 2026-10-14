import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PageRecipe } from "../recipe/types";
import { MAX_CONCURRENCY, DEFAULT_CONFIG, validateConfig } from "./batch";
import { buildStaticFiles, mapVercelState, statusFromWebhook, vercelConfig, verifyVercelSignature } from "./deployments";
import { METRICS } from "./metrics";
import { diffRecipes, esc, renderRecipeDocument } from "./render";
import { STAGE_IDS } from "./stages";

// Contratos da fábrica SEM banco: definições de métricas, renderer único, diferenças entre versões, validação de lote e mapeamento de estados da Vercel. As respostas da Vercel são CONSTRUÍDAS da documentação (não capturadas).
const recipe = (over: Partial<PageRecipe> = {}): PageRecipe => ({ pageId: "p1", topicId: "t".repeat(64), tenantId: "t1", family: "04-cidade", templateId: "city-overview", templateGap: false, specBlueprintId: "b1", specBlueprintVersion: 1, url: "/cidades/sp/sao-paulo", canonical: "/cidades/sp/sao-paulo", robots: "noindex",
  title: "São Paulo <script>", h1: "São Paulo & região", metaDescription: "Dados \"reais\"", entities: [{ key: "ibge:1", name: "São Paulo", uf: "SP" }],
  modules: [{ moduleId: "identificacao", status: "RICH", minItems: 1, onMissing: "remove", render: "RENDERED" }, { moduleId: "clima", status: "DATA_PENDING", minItems: 1, onMissing: "remove", render: "REMOVED" }, { moduleId: "demografia", status: "PARTIAL", minItems: 2, onMissing: "show_insufficiency", render: "INSUFFICIENCY_SHOWN" }],
  facts: [], blocks: [{ blockId: "identificacao:h", moduleId: "identificacao", kind: "heading", text: "Identificação", refs: [], source: "template" }, { blockId: "identificacao:p", moduleId: "identificacao", kind: "paragraph", text: "População 11.911.337 <b>x</b>", refs: ["f1"], source: "agent7" }, { blockId: "demografia:i", moduleId: "demografia", kind: "insufficiency", text: "Dados insuficientes.", refs: [], source: "template" }],
  jsonLd: [{ "@type": "City", name: "</script><script>alert(1)</script>" }], links: [{ path: "/cidades/sp/campinas", text: "Campinas" }, { path: "javascript:alert(1)", text: "mau" }], travelTime: null, referenceTime: "2026-10-14T12:00:00Z", ...over });

describe("definições de métricas", () => {
  it("ids únicos; cada métrica declara significado, fonte, escopo e tipo; indexação não é instrumentada", () => {
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length);
    for (const m of METRICS) { expect(m.meaning.length, m.id).toBeGreaterThan(20); expect(m.source, m.id).toBeTruthy(); expect(m.scope, m.id).toBeTruthy(); expect(["current_state", "accumulated", "period_events", "unique_pages", "versions", "attempts", "deployments"]).toContain(m.kind); }
    for (const id of ["topics_discovered", "combinations_evaluated", "opportunities_eligible", "blueprints_created", "pages_generated", "pages_qa_passed", "pages_awaiting_approval", "deployments_verified", "pages_blocked", "generation_failures"]) expect(METRICS.some((m) => m.id === id), id).toBe(true);
  });
  it("versões e eventos nunca são rotulados como páginas únicas", () => {
    expect(METRICS.find((m) => m.id === "recipe_versions")!.kind).toBe("versions"); expect(METRICS.find((m) => m.id === "combinations_evaluated")!.kind).toBe("accumulated"); expect(METRICS.find((m) => m.id === "generation_failures")!.kind).toBe("period_events"); expect(METRICS.find((m) => m.id === "pages_generated")!.kind).toBe("unique_pages");
  });
  it("as 16 etapas do pipeline existem, na ordem pedida", () => { expect(STAGE_IDS).toHaveLength(16); expect(STAGE_IDS[0]).toBe("data_ingestion"); expect(STAGE_IDS[15]).toBe("deployment_verification"); });
});

describe("renderer único do recipe", () => {
  it("escapa tudo (título, h1, meta, texto) e não deixa o JSON-LD fechar a tag script", () => {
    const d = renderRecipeDocument(recipe());
    expect(d.html).toContain("<title>São Paulo &lt;script&gt;</title>"); expect(d.html).toContain("<h1>São Paulo &amp; região</h1>"); expect(d.html).toContain('content="Dados &quot;reais&quot;"'); expect(d.html).toContain("População 11.911.337 &lt;b&gt;x&lt;/b&gt;");
    expect(d.html).not.toContain("</script><script>"); expect(d.html).toContain("\\u003c/script\\u003e"); expect(esc("<'&\">")).toBe("&lt;&#39;&amp;&quot;&gt;");
  });
  it("link com esquema perigoso vira âncora vazia; metadados de SEO e robots saem do recipe", () => {
    const d = renderRecipeDocument(recipe()); expect(d.html).toContain('href="/cidades/sp/campinas"'); expect(d.html).toContain('href="#"'); expect(d.html).not.toContain("javascript:");
    expect(d.html).toContain('<meta name="robots" content="noindex">'); expect(d.html).toContain('<link rel="canonical" href="/cidades/sp/sao-paulo">'); expect(d.seo).toMatchObject({ robots: "noindex", url: "/cidades/sp/sao-paulo" });
  });
  it("é determinístico e o documento publicável NÃO tem anotações; o preview anotado marca origem, referências e módulos removidos", () => {
    expect(renderRecipeDocument(recipe()).html).toBe(renderRecipeDocument(recipe()).html);
    expect(renderRecipeDocument(recipe()).html).not.toContain("data-block="); expect(renderRecipeDocument(recipe()).html).not.toContain("data-removed-module=");
    const a = renderRecipeDocument(recipe(), { annotate: true }).html; expect(a).toContain('data-source="agent7"'); expect(a).toContain('data-refs="f1"'); expect(a).toContain('data-removed-module="clima"');
  });
  it("explica por que cada módulo foi renderizado, omitido ou mostrou insuficiência, e conta o que faltou", () => {
    const d = renderRecipeDocument(recipe());
    expect(d.modules.map((m) => [m.moduleId, m.render])).toEqual([["identificacao", "RENDERED"], ["clima", "REMOVED"], ["demografia", "INSUFFICIENCY_SHOWN"]]);
    expect(d.modules.find((m) => m.moduleId === "clima")!.why).toMatch(/omitido/); expect(d.stats).toMatchObject({ blocks: 3, paragraphs: 1, insufficiencies: 2, textFromAgent7: 1 });
    expect(d.html).not.toContain("data-module=\"clima\""); expect(d.html).toContain('data-module="demografia"');
  });
  it("a comparação entre versões mostra SEO e blocos alterados, adicionados e removidos", () => {
    const b = recipe({ title: "Novo", blocks: [{ blockId: "identificacao:h", moduleId: "identificacao", kind: "heading", text: "Identificação", refs: [], source: "template" }, { blockId: "identificacao:p", moduleId: "identificacao", kind: "paragraph", text: "Outro texto", refs: [], source: "template" }, { blockId: "novo:p", moduleId: "novo", kind: "paragraph", text: "x", refs: [], source: "template" }] });
    const d = diffRecipes(recipe(), b);
    expect(d.seo).toEqual([{ field: "title", before: "São Paulo <script>", after: "Novo" }]);
    expect(d.blocks.map((x) => [x.blockId, x.change])).toEqual([["identificacao:p", "changed"], ["demografia:i", "removed"], ["novo:p", "added"]]);
    expect(d.blocks[0]).toMatchObject({ sourceBefore: "agent7", sourceAfter: "template" }); expect(diffRecipes(recipe(), recipe())).toEqual({ seo: [], blocks: [] });
  });
});

describe("validação da configuração do lote", () => {
  it("limites de concorrência, tamanho e quantidade são recusados fora da faixa", () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([]);
    expect(validateConfig({ ...DEFAULT_CONFIG, concurrency: MAX_CONCURRENCY + 1 })).toHaveLength(1); expect(validateConfig({ ...DEFAULT_CONFIG, concurrency: 0 })).toHaveLength(1);
    expect(validateConfig({ ...DEFAULT_CONFIG, limit: 0, batchSize: 101, maxModelCallsPerPage: 0 })).toHaveLength(3);
    expect(validateConfig({ ...DEFAULT_CONFIG, geo: { uf: "SPX" } })).toEqual(["UF inválida"]); expect(validateConfig({ ...DEFAULT_CONFIG, target: "x" as never })).toEqual(["destino inválido"]);
  });
  it("o destino padrão é preview, nunca produção", () => expect(DEFAULT_CONFIG.target).toBe("preview"));
});

describe("adaptador da Vercel: estados, configuração e webhook", () => {
  it("mapeia o readyState do provedor e NÃO adivinha estado desconhecido", () => {
    expect(["QUEUED", "INITIALIZING", "BUILDING", "READY", "ERROR", "CANCELED", "DELETED"].map(mapVercelState)).toEqual(["QUEUED", "BUILDING", "BUILDING", "READY", "FAILED", "CANCELED", "CANCELED"]);
    expect(mapVercelState("MARCIANO")).toBeNull(); expect(mapVercelState(null)).toBeNull(); expect(mapVercelState("ready")).toBe("READY");
  });
  it("sem token ou projeto a configuração diz exatamente o que falta; nunca aceita vazio", () => {
    expect(vercelConfig({})).toEqual({ configured: false, missing: ["VERCEL_TOKEN", "VERCEL_PROJECT"] }); expect(vercelConfig({ VERCEL_TOKEN: "  ", VERCEL_PROJECT: "p" })).toEqual({ configured: false, missing: ["VERCEL_TOKEN"] });
    expect(vercelConfig({ VERCEL_TOKEN: "t", VERCEL_PROJECT: "p", VERCEL_TEAM_ID: "team_1" })).toEqual({ configured: true, token: "t", project: "p", teamId: "team_1" });
  });
  it("assinatura do webhook: HMAC-SHA1 do corpo bruto; adulterado, ausente ou outro segredo é recusado", () => {
    const body = JSON.stringify({ type: "deployment.ready" }); const sig = createHmac("sha1", "segredo").update(body).digest("hex");
    expect(verifyVercelSignature(body, sig, "segredo")).toBe(true); expect(verifyVercelSignature(body + " ", sig, "segredo")).toBe(false); expect(verifyVercelSignature(body, sig, "outro")).toBe(false); expect(verifyVercelSignature(body, null, "segredo")).toBe(false); expect(verifyVercelSignature(body, sig, "")).toBe(false);
    expect(statusFromWebhook("deployment.error")).toBe("FAILED"); expect(statusFromWebhook("deployment.ready")).toBe("READY"); expect(statusFromWebhook("project.created")).toBeNull();
  });
  it("os arquivos do deployment são ordenados e cada página vira <caminho>/index.html com o HTML do renderer", () => {
    const f = buildStaticFiles([{ path: "/cidades/sp/b", html: "B" }, { path: "/cidades/sp/a/", html: "A" }]);
    expect(f.map((x) => x.file)).toEqual(["cidades/sp/a/index.html", "cidades/sp/b/index.html"]); expect(f[0]).toMatchObject({ data: "A", encoding: "utf-8" });
  });
});
