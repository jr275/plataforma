import { FACT_LABELS, PILOT_MIN_VALID, describeOmissions, meetsPilotAcceptance, reviewFacts, type GateResult, type GenerationRunDetail, type PageDetail, type PageVersionView } from "@plataforma/api";
import type { FlowDefinition, FlowEdgeSpec, FlowNodeSpec, FlowStatus, InspectorItem, InspectorRow } from "@/lib/flow/model";
import { GATE_LABEL, formatDateTime, formatInt } from "./format";

// Constrói a DEFINIÇÃO e o ESTADO do fluxo a partir de registros reais (página e execução). Funções puras: o mesmo dado gera o mesmo
// fluxo. Regras: nada de duração, contagem ou progresso inventado; etapa sem capacidade no backend é "unavailable" e diz isso;
// etapa que esta geração não usa é "skipped" e diz por quê. Não existe nota composta (regra 5, ADR-002): o juiz mostra a CONTAGEM de gates.

const GATES: readonly GateResult["gate"][] = ["required_fields", "url_unique", "url_stable", "metadata_valid", "links_resolve", "facts_traceable"];

const NOT_USED_FOR_CITIES = "O template de município (ADR-019/020) monta a página só a partir de fatos de origem real; esta etapa não participa da geração de páginas desta versão.";
const NO_PUBLISH = "A publicação (etapa 5) ainda não existe: nenhuma página é publicada nem indexável. A página permanece em rascunho.";
const NO_OBSERVE = "O Search Console tem integração própria (Integrations), mas ainda não está ligado às páginas geradas: não há indexação nem desempenho por página.";
const NO_LEARN = "Não existe ciclo de aprendizado: nenhuma observação pós-publicação é registrada.";

const gateStatus = (o: GateResult["outcome"]): FlowStatus => (o === "pass" ? "completed" : o === "fail" ? "failed" : "skipped");
const short = (hash: string): string => hash.slice(0, 8);

function node(n: Omit<FlowNodeSpec, "detail"> & { detail: FlowNodeSpec["detail"] }): FlowNodeSpec { return n; }

// Posições fixas (px): o grafo é uma definição, não um layout recalculado a cada atualização.
// Cards grandes de um só tamanho (20rem × 13rem = 320 × 208 px): passo de 380 px entre colunas e de 240 px entre linhas.
const X = { source: 0, entity: 380, knowledge: 760, recipe: 1140, generate: 1520, gates: 1900, judge: 2280, render: 2660, publish: 3040, observe: 3420, learn: 3800 } as const;
const MAIN_Y = 240;
// Layout em BANDAS (cards 320 × 208 px; coluna a cada 380 px, linha a cada 300 px): o fluxo inteiro cabe na abertura e as ligações são
// árvores em ângulo reto. As posições abaixo substituem as dos nós (uma única tabela por fluxo).
const COL = 380;
const ROW = 300;
const at = (col: number, row: number) => ({ x: col * COL, y: row * ROW });
const place = (nodes: FlowNodeSpec[], pos: Readonly<Record<string, { x: number; y: number }>>): FlowNodeSpec[] => nodes.map((n) => ({ ...n, ...(pos[n.id] ?? {}) }));
const PAGE_POS: Readonly<Record<string, { x: number; y: number }>> = {
  intel: at(2, 0), opportunity: at(3, 0),
  source: at(0, 1), entity: at(1, 1), knowledge: at(2, 1), recipe: at(3, 1), generate: at(4, 1),
  ...Object.fromEntries(GATES.map((g, i) => [`gate:${g}`, at(i, 2)])),
  judge: at(2.5, 3), render: at(1.5, 4), og: at(3.5, 4), publish: at(2.5, 5), observe: at(3.5, 5), learn: at(4.5, 5),
};
const RUN_POS: Readonly<Record<string, { x: number; y: number }>> = {
  scope: at(0, 0), template: at(1, 0), process: at(2, 0),
  ...Object.fromEntries(GATES.map((g, i) => [`gate:${g}`, at(i, 1)])),
  judge: at(2.5, 2), pilot: at(2.5, 3), publish: at(3.5, 3),
};
const GATE_Y0 = -360;
const GATE_STEP = 240;

export function buildPageFlow(detail: PageDetail, shown: PageVersionView | undefined, now: Date): FlowDefinition {
  const { page, latestAttempt: attempt } = detail;
  const hasVersion = shown !== undefined;
  const gates = attempt?.gates ?? [];
  const byGate = new Map(gates.map((g) => [g.gate, g]));
  const requiredFailed = byGate.get("required_fields")?.outcome === "fail";
  const failed = gates.filter((g) => g.outcome === "fail");
  const passed = gates.filter((g) => g.outcome === "pass").length;
  const content = shown?.content;
  const omissions = content ? describeOmissions(content) : [];
  const review = content ? reviewFacts(content, now).filter((r) => r.review) : [];
  const sourcesUsed = content ? [...new Set(content.factsUsed.map((f) => f.source.name))] : [];
  const runLink = attempt ? [{ label: "Ver a execução desta tentativa", href: `/generation/runs/${attempt.runId}` }] : [];

  const blockedByInput: Pick<FlowNodeSpec, "status"> = { status: requiredFailed ? "failed" : "idle" };
  const requiredDetail = byGate.get("required_fields")?.detail;

  const nodes: FlowNodeSpec[] = [
    node({
      id: "source", kind: "source", title: "Fonte de dados", description: "De onde vêm os fatos desta página.", x: X.source, y: MAIN_Y,
      status: hasVersion ? "completed" : blockedByInput.status,
      summary: hasVersion ? sourcesUsed.join(", ") || "Sem fonte registrada" : (requiredDetail ?? "Sem versão aprovada ainda"),
      metrics: hasVersion ? [{ label: "Fontes", value: String(sourcesUsed.length) }] : undefined,
      detail: {
        purpose: "Origem verificável dos fatos. Só dado de origem real entra: fonte de teste ou manual é recusada pelo gate de origem.",
        rows: hasVersion && content
          ? [{ label: "Fontes usadas", value: sourcesUsed.join(", ") || "—" }, ...[...new Map(content.factsUsed.map((f) => [f.source.runId, f.source])).values()].map((s): InspectorRow => ({ label: "Importação", value: `${s.name} · coletada em ${s.collectedAt}`, tone: "muted" }))]
          : [{ label: "Estado", value: "Nenhuma versão aprovada: não há fatos aceitos para mostrar.", tone: "warn" }],
        blocker: !hasVersion && requiredFailed ? requiredDetail : undefined,
        downstream: ["Fatos e evidências"],
      },
    }),
    node({
      id: "entity", kind: "entity", title: "Entidade (município)", description: "Quem é a cidade e qual o seu código IBGE.", x: X.entity, y: MAIN_Y,
      status: "completed", summary: `${page.cityName}, ${page.uf}`,
      metrics: [{ label: "IBGE", value: content?.ibgeCode ?? "—" }],
      detail: {
        purpose: "Identidade única do município no workspace (código IBGE de 7 dígitos, único por tenant).",
        rows: [
          { label: "Município", value: `${page.cityName}, ${page.uf}` }, { label: "Região", value: page.region ?? "—" },
          { label: "População (cadastro)", value: page.population === null || page.population === undefined ? "ausente" : formatInt(page.population), tone: page.population == null ? "warn" : "default" },
          ...(content ? [{ label: "Código IBGE", value: content.ibgeCode }] : []),
        ],
        downstream: ["Fatos e evidências"],
      },
    }),
    node({
      id: "knowledge", kind: "knowledge", title: "Fatos e evidências", description: "Cada número da página liga a um fato com fonte.", x: X.knowledge, y: MAIN_Y,
      status: hasVersion ? (review.length > 0 ? "needs_review" : "completed") : blockedByInput.status,
      summary: hasVersion && content ? `${content.factsUsed.length} fatos com fonte${review.length ? ` · ${review.length} para revisar` : ""}` : undefined,
      metrics: hasVersion && content ? [{ label: "Fatos", value: String(content.factsUsed.length) }, { label: "A revisar", value: String(review.length) }] : undefined,
      detail: {
        purpose: "Regra 1: fato nunca é gerado por LLM. Todo número do texto vem de um fato com fonte, confiança e validade.",
        rows: hasVersion && content ? [{ label: "Fatos usados", value: String(content.factsUsed.length) }, { label: "Confiança", value: "alta (única que o motor aceita hoje)" }, { label: "Para revisar", value: review.length ? `${review.length}: coletados há mais de 365 dias (aviso, não bloqueia)` : "nenhum", tone: review.length ? "warn" : "good" }] : [{ label: "Estado", value: "Sem fatos aceitos nesta página.", tone: "warn" }],
        items: content?.factsUsed.map((f): InspectorItem => ({ title: FACT_LABELS[f.key], text: `${String(f.value)} · ${f.source.name} · coletado em ${f.source.collectedAt}${f.asOf !== undefined && f.key !== "population_year" ? ` · referência ${f.asOf}` : ""}`, tone: review.some((r) => r.factId === f.id) ? "warn" : "default" })),
        blocker: !hasVersion && requiredFailed ? requiredDetail : undefined,
        downstream: ["Receita e template", "Quality Gates"],
      },
    }),
    node({ id: "intel", kind: "intel", title: "Search Intelligence", description: "Demanda, intenção e SERPs.", x: X.knowledge, y: -10, status: "skipped", summary: "Não usada nesta geração",
      detail: { purpose: "Pesquisa de demanda e intenção de busca para escolher o que gerar.", rows: [{ label: "Estado", value: "Não usada nesta geração", tone: "muted" }], blocker: NOT_USED_FOR_CITIES, downstream: ["Opportunity Engine"] } }),
    node({ id: "opportunity", kind: "intel", title: "Opportunity Engine", description: "Decide qual oportunidade virar página.", x: X.recipe, y: -10, status: "skipped", summary: "Não usada nesta geração",
      detail: { purpose: "Seleciona entidade, intenção e tipo de página com valor potencial.", rows: [{ label: "Estado", value: "Não usada nesta geração", tone: "muted" }], blocker: NOT_USED_FOR_CITIES, downstream: ["Receita e template"] } }),
    node({
      id: "recipe", kind: "recipe", title: "Receita e template", description: "Contrato de renderização da página.", x: X.recipe, y: MAIN_Y,
      status: hasVersion ? "completed" : "idle", summary: content ? `${content.template.key} v${content.template.version}` : undefined,
      metrics: content ? [{ label: "Hash", value: short(content.template.hash) }] : undefined,
      detail: {
        purpose: "O template é um contrato: define seções, parágrafos condicionais e quais fatos cada um exige. Não é um prompt livre.",
        rows: content ? [{ label: "Template", value: `${content.template.key} v${content.template.version}` }, { label: "Hash do template", value: short(content.template.hash), tone: "muted" }, { label: "Hash do conteúdo", value: short(content.contentHash), tone: "muted" }] : [{ label: "Estado", value: "Nenhuma versão aprovada.", tone: "warn" }],
        downstream: ["Conteúdo e módulos"],
      },
    }),
    node({
      id: "generate", kind: "generate", title: "Conteúdo e módulos", description: "Seções montadas só com fatos disponíveis.", x: X.generate, y: MAIN_Y,
      status: requiredFailed && !hasVersion ? "blocked" : hasVersion || attempt ? "completed" : "idle",
      summary: content ? `${content.sections.length} seções${omissions.length ? ` · ${omissions.length} omitida(s) por falta de dado` : ""}` : requiredFailed ? "Bloqueada: falta dado obrigatório" : undefined,
      metrics: content ? [{ label: "Seções", value: String(content.sections.length) }, { label: "Omitidas", value: String(omissions.length) }, { label: "Links", value: String(content.links.length) }] : undefined,
      detail: {
        purpose: "Monta o texto só a partir dos fatos; o que o template prevê e não tem dado é omitido, nunca inventado.",
        rows: content ? [{ label: "Seções", value: String(content.sections.length) }, { label: "Links internos", value: String(content.links.length) }, { label: "Título", value: content.title }, { label: "Meta description", value: `${content.metaDescription.length} caracteres`, tone: "muted" }] : [{ label: "Estado", value: "Sem conteúdo gerado.", tone: "warn" }],
        items: omissions.map((o): InspectorItem => ({ title: `${o.wholeSection ? "Seção omitida" : "Parágrafo omitido"}: ${o.heading}`, text: "Falta dado de origem para este módulo.", tone: "warn" })),
        blocker: !hasVersion && requiredFailed ? requiredDetail : undefined,
        downstream: ["Quality Gates"],
      },
    }),
    ...GATES.map((gate, i): FlowNodeSpec => {
      const g = byGate.get(gate);
      return node({
        id: `gate:${gate}`, kind: "gate", title: GATE_LABEL[gate], description: "Quality Gate determinístico.", x: X.gates, y: GATE_Y0 + i * GATE_STEP,
        status: g ? gateStatus(g.outcome) : "idle", summary: g ? g.detail : undefined,
        detail: {
          purpose: `Gate ${gate}: cada gate grava o próprio resultado; nenhum é compensado pela média dos outros.`,
          rows: [{ label: "Resultado", value: g ? (g.outcome === "pass" ? "Passou" : g.outcome === "fail" ? "Reprovou" : "Não avaliado") : "Sem tentativa registrada", tone: g?.outcome === "pass" ? "good" : g?.outcome === "fail" ? "bad" : "muted" }, ...(g ? [{ label: "Detalhe", value: g.detail }] : [])],
          blocker: g?.outcome === "fail" ? g.detail : undefined,
          downstream: ["Decisão final"], links: runLink,
        },
      });
    }),
    node({
      id: "judge", kind: "judge", title: "Decisão final", description: "Aprova ou bloqueia a página.", x: X.judge, y: MAIN_Y,
      status: !attempt ? "idle" : attempt.outcome === "blocked" ? "failed" : "completed",
      summary: !attempt ? undefined : attempt.outcome === "blocked" ? `FAIL · ${failed.length} gate(s) reprovaram` : `PASS · ${passed} de ${GATES.length} gates`,
      progress: attempt ? passed / GATES.length : undefined,
      metrics: attempt ? [{ label: "Gates ok", value: `${passed}/${GATES.length}` }] : undefined,
      detail: {
        purpose: "Decisão determinística dos gates: um gate reprovado bloqueia a página, não importa quantos outros passaram. Não há nota composta nem juiz de IA nesta versão.",
        rows: attempt
          ? [{ label: "Veredito", value: attempt.outcome === "blocked" ? "FAIL" : attempt.outcome === "unchanged" ? "PASS (conteúdo idêntico ao anterior)" : "PASS", tone: attempt.outcome === "blocked" ? "bad" : "good" }, { label: "Gates aprovados", value: `${passed} de ${GATES.length}` }, { label: "Tentativa", value: formatDateTime(attempt.startedAt), tone: "muted" }, { label: "Publicação permitida?", value: "Não: a etapa de publicação não existe; a página fica em rascunho.", tone: "muted" }]
          : [{ label: "Estado", value: "Nenhuma tentativa registrada.", tone: "muted" }],
        items: failed.map((g): InspectorItem => ({ title: GATE_LABEL[g.gate], text: g.detail, tone: "bad" })),
        blocker: attempt?.outcome === "blocked" ? "Corrija o dado de origem e reprocesse a página: os gates relevantes rodam de novo e a nova tentativa é registrada." : undefined,
        downstream: ["Renderização e QA", "Imagem OG", "Remediação (se FAIL)"], links: runLink,
      },
    }),
    node({
      id: "render", kind: "render", title: "Renderização e QA", description: "Prévia renderizada da versão aprovada.", x: X.render, y: 120,
      status: hasVersion ? "completed" : attempt?.outcome === "blocked" ? "blocked" : "idle", summary: shown ? `Versão ${shown.version} renderizada` : undefined,
      detail: { purpose: "Renderiza o conteúdo aprovado no mesmo componente da prévia (React). É só uma prévia: nada está publicado.", rows: shown ? [{ label: "Versão", value: String(shown.version) }, { label: "Criada em", value: formatDateTime(shown.createdAt) }, { label: "Caminho", value: content?.path ?? "—", tone: "muted" }] : [{ label: "Estado", value: "Sem versão para renderizar.", tone: "warn" }], downstream: ["Publicação"] },
    }),
    node({
      id: "og", kind: "render", title: "Imagem OG (prévia)", description: "Cartão de compartilhamento com o título da página.", x: X.render, y: 360,
      status: hasVersion ? "completed" : "idle", summary: shown ? "Gerada com next/og, sob demanda" : undefined,
      detail: { purpose: "Imagem Open Graph gerada dinamicamente a partir do título e da cidade (Vercel OG / next/og). É uma prévia autenticada: não é guardada nem publicada.", rows: [{ label: "Origem", value: "Título e cidade da versão exibida" }, { label: "Tamanho", value: "1200 × 630" }], downstream: ["Publicação"] },
    }),
    node({ id: "publish", kind: "publish", title: "Publicação", description: "URL canônica, sitemap, links internos.", x: X.publish, y: MAIN_Y, status: "unavailable", summary: "Não implementada",
      detail: { purpose: "Publicar a URL canônica, o sitemap, os links internos e os controles de indexação.", rows: [{ label: "Estado", value: "Não implementada", tone: "muted" }], blocker: NO_PUBLISH, downstream: ["Indexação e desempenho"] } }),
    node({ id: "observe", kind: "observe", title: "Indexação e desempenho", description: "Indexação, cliques, citações e conversões.", x: X.observe, y: MAIN_Y, status: "unavailable", summary: "Não ligada às páginas",
      detail: { purpose: "Medir indexação, impressões, cliques e visibilidade GEO depois da publicação. É uma decisão separada da aprovação.", rows: [{ label: "Estado", value: "Não ligada às páginas geradas", tone: "muted" }], blocker: NO_OBSERVE, downstream: ["Aprendizado"] } }),
    node({ id: "learn", kind: "learn", title: "Aprendizado", description: "Ajusta a receita com base nos resultados.", x: X.learn, y: MAIN_Y, status: "unavailable", summary: "Não implementado",
      detail: { purpose: "Usar o desempenho medido para melhorar templates e prioridades.", rows: [{ label: "Estado", value: "Não implementado", tone: "muted" }], blocker: NO_LEARN, downstream: [] } }),
  ];

  const judgeFailed = attempt?.outcome === "blocked";
  const edges: FlowEdgeSpec[] = [
    { id: "e:source-entity", source: "source", target: "entity" },
    { id: "e:entity-knowledge", source: "entity", target: "knowledge" },
    { id: "e:knowledge-recipe", source: "knowledge", target: "recipe" },
    { id: "e:knowledge-intel", source: "knowledge", target: "intel", muted: true, sourceHandle: "tu", targetHandle: "bt" },
    { id: "e:intel-opportunity", source: "intel", target: "opportunity", muted: true },
    { id: "e:opportunity-recipe", source: "opportunity", target: "recipe", muted: true, sourceHandle: "b", targetHandle: "t" },
    { id: "e:recipe-generate", source: "recipe", target: "generate" },
    ...GATES.map((g): FlowEdgeSpec => ({ id: `e:generate-${g}`, source: "generate", target: `gate:${g}`, sourceHandle: "b", targetHandle: "t" })),
    ...GATES.map((g): FlowEdgeSpec => ({ id: `e:${g}-judge`, source: `gate:${g}`, target: "judge", sourceHandle: "b", targetHandle: "t" })),
    { id: "e:judge-render", source: "judge", target: "render", label: "PASS", muted: !hasVersion, sourceHandle: "b", targetHandle: "t" },
    { id: "e:judge-og", source: "judge", target: "og", label: "PASS", muted: !hasVersion, sourceHandle: "b", targetHandle: "t" },
    { id: "e:render-publish", source: "render", target: "publish", muted: true, sourceHandle: "b", targetHandle: "t" },
    { id: "e:og-publish", source: "og", target: "publish", muted: true, sourceHandle: "b", targetHandle: "t" },
    { id: "e:publish-observe", source: "publish", target: "observe", muted: true },
    { id: "e:observe-learn", source: "observe", target: "learn", muted: true },
    { id: "e:judge-remediation", source: "judge", target: "source", remediation: true, sourceHandle: "ls", targetHandle: "l", label: "FAIL: corrigir o dado e reprocessar", active: judgeFailed, muted: !judgeFailed },
  ];

  return { id: `page:${page.id}`, title: `${page.cityName}, ${page.uf}`, nodes: place(nodes, PAGE_POS), edges, mode: "recorded" };
}

/** Fluxo de uma EXECUÇÃO (lote): progresso por contagem real de itens registrados; ao vivo enquanto a execução está em andamento. */
export function buildRunFlow(d: GenerationRunDetail): FlowDefinition {
  const { run, items } = d;
  const running = run.status === "running";
  const recorded = items.length;
  const total = run.totalItems;
  const failedRun = run.status === "failed";
  const gateCounts = new Map<GateResult["gate"], { pass: number; fail: number; skipped: number }>(GATES.map((g) => [g, { pass: 0, fail: 0, skipped: 0 }]));
  for (const it of items) for (const g of it.gates) { const c = gateCounts.get(g.gate); if (c) c[g.outcome] += 1; }
  const generated = running ? items.filter((i) => i.outcome === "generated").length : run.generatedItems;
  const unchanged = running ? items.filter((i) => i.outcome === "unchanged").length : run.unchangedItems;
  const blocked = running ? items.filter((i) => i.outcome === "blocked").length : run.blockedItems;
  const done = running ? recorded >= total && total > 0 : true;
  const pilotOk = meetsPilotAcceptance({ generated, unchanged });
  const scope = d.scope as { uf?: unknown; limit?: unknown; cityIds?: unknown };
  const scopeText = typeof scope.uf === "string" ? `${scope.uf} · até ${String(scope.limit)} cidades (maiores populações)` : Array.isArray(scope.cityIds) ? `${scope.cityIds.length} cidade(s) escolhida(s)` : "Escopo registrado";
  const link = (id: string | null, label: string) => (id ? [{ label, href: `/generation/pages/${id}` }] : []);

  const X2 = { scope: 0, template: 380, process: 760, gates: 1140, judge: 1520, pilot: 1900, publish: 2280 } as const;
  const nodes: FlowNodeSpec[] = [
    node({ id: "scope", kind: "scope", title: "Escopo da execução", description: "Quais cidades entram.", x: X2.scope, y: MAIN_Y, status: "completed", summary: scopeText,
      detail: { purpose: "O que o usuário pediu: uma UF com limite, ou cidades escolhidas. Validado no servidor antes de qualquer efeito.", rows: [{ label: "Escopo", value: scopeText }, { label: "Cidades previstas", value: formatInt(total) }, { label: "Criada por", value: run.createdBy, tone: "muted" }, { label: "Início", value: formatDateTime(run.startedAt) }], downstream: ["Template"] } }),
    node({ id: "template", kind: "recipe", title: "Template", description: "Receita aplicada a todas as cidades.", x: X2.template, y: MAIN_Y, status: "completed", summary: `${run.templateKey} v${run.templateVersion}`,
      detail: { purpose: "Contrato de renderização aplicado a cada cidade desta execução.", rows: [{ label: "Template", value: `${run.templateKey} v${run.templateVersion}` }], downstream: ["Processamento por cidade"] } }),
    node({
      id: "process", kind: "generate", title: "Processamento por cidade", description: "Fatos → conteúdo → gates, uma cidade por vez.", x: X2.process, y: MAIN_Y,
      status: failedRun ? "failed" : running ? "running" : "completed",
      summary: running ? `${formatInt(recorded)} de ${formatInt(total)} cidades registradas` : `${formatInt(total)} cidades processadas`,
      progress: total > 0 ? Math.min(1, (running ? recorded : total) / total) : undefined,
      metrics: [{ label: "Registradas", value: formatInt(recorded) }, { label: "Previstas", value: formatInt(total) }],
      detail: {
        purpose: "Cada cidade é processada de forma isolada: uma falha não derruba as outras. Uma execução por tenant por vez.",
        rows: [{ label: "Estado da execução", value: running ? "Em andamento (atualiza sozinha a cada 3 s)" : failedRun ? "Falhou" : run.status === "partial" ? "Parcial" : "Concluída", tone: running ? "default" : failedRun ? "bad" : "good" }, { label: "Itens registrados", value: `${formatInt(recorded)} de ${formatInt(total)}` }, ...(run.finishedAt ? [{ label: "Fim", value: formatDateTime(run.finishedAt) }] : [])],
        blocker: failedRun ? (run.error ?? "A execução falhou antes de fechar.") : undefined,
        downstream: ["Quality Gates"],
      },
    }),
    ...GATES.map((gate, i): FlowNodeSpec => {
      const c = gateCounts.get(gate)!;
      const evaluated = c.pass + c.fail + c.skipped;
      return node({
        id: `gate:${gate}`, kind: "gate", title: GATE_LABEL[gate], description: "Quality Gate determinístico.", x: X2.gates, y: GATE_Y0 + i * GATE_STEP,
        status: c.fail > 0 ? "failed" : evaluated === 0 ? (running ? "queued" : "idle") : running && !done ? "running" : "completed",
        summary: evaluated === 0 ? undefined : `${formatInt(c.pass)} passaram · ${formatInt(c.fail)} reprovaram${c.skipped ? ` · ${formatInt(c.skipped)} não avaliados` : ""}`,
        detail: { purpose: `Gate ${gate}, somado sobre as cidades já registradas.`, rows: [{ label: "Passaram", value: formatInt(c.pass), tone: "good" }, { label: "Reprovaram", value: formatInt(c.fail), tone: c.fail ? "bad" : "default" }, { label: "Não avaliados", value: formatInt(c.skipped), tone: "muted" }], items: items.filter((it) => it.gates.some((g) => g.gate === gate && g.outcome === "fail")).slice(0, 8).map((it): InspectorItem => ({ title: it.cityName, text: it.gates.find((g) => g.gate === gate)?.detail ?? "", tone: "bad" })), downstream: ["Decisão por cidade"], links: [] },
      });
    }),
    node({
      id: "judge", kind: "judge", title: "Decisão por cidade", description: "Gerada, inalterada ou bloqueada.", x: X2.judge, y: MAIN_Y,
      status: failedRun ? "failed" : running ? (recorded > 0 ? "running" : "queued") : run.status === "partial" ? "needs_review" : "completed",
      summary: `${formatInt(generated)} geradas · ${formatInt(unchanged)} inalteradas · ${formatInt(blocked)} bloqueadas`,
      metrics: [{ label: "Geradas", value: formatInt(generated) }, { label: "Inalteradas", value: formatInt(unchanged) }, { label: "Bloqueadas", value: formatInt(blocked) }],
      detail: {
        purpose: "Uma decisão por cidade, sem nota composta. A cidade bloqueada guarda o motivo (gate que reprovou).",
        rows: [{ label: "Geradas", value: formatInt(generated), tone: "good" }, { label: "Inalteradas", value: formatInt(unchanged), tone: "muted" }, { label: "Bloqueadas", value: formatInt(blocked), tone: blocked ? "bad" : "default" }],
        items: items.filter((i) => i.outcome === "blocked").slice(0, 12).map((i): InspectorItem => ({ title: i.cityName, text: i.gates.filter((g) => g.outcome === "fail").map((g) => `${GATE_LABEL[g.gate]}: ${g.detail}`).join(" · ") || i.error || "Bloqueada", tone: "bad" })),
        blocker: blocked > 0 ? "Corrija o dado de origem das cidades bloqueadas e reprocese cada página." : undefined,
        downstream: ["Critério do piloto"], links: link(items.find((i) => i.outcome === "blocked")?.pageId ?? null, "Abrir a primeira página bloqueada"),
      },
    }),
    node({
      id: "pilot", kind: "judge", title: "Critério do piloto", description: `Pelo menos ${PILOT_MIN_VALID} páginas válidas.`, x: X2.pilot, y: MAIN_Y,
      status: running ? "queued" : pilotOk ? "completed" : "failed", summary: running ? "Aguardando o fim da execução" : pilotOk ? `PASS · ${formatInt(generated + unchanged)} válidas` : `FAIL · ${formatInt(generated + unchanged)} de ${PILOT_MIN_VALID}`,
      detail: { purpose: "Aceite do piloto (etapa 4): páginas válidas (geradas ou inalteradas) pelo menos no mínimo definido no código.", rows: [{ label: "Mínimo", value: String(PILOT_MIN_VALID) }, { label: "Válidas", value: formatInt(generated + unchanged), tone: running ? "muted" : pilotOk ? "good" : "bad" }], downstream: ["Publicação"] },
    }),
    node({ id: "publish", kind: "publish", title: "Publicação", description: "Depende de aprovação e de uma etapa que ainda não existe.", x: X2.publish, y: MAIN_Y, status: "unavailable", summary: "Não implementada",
      detail: { purpose: "Publicar páginas aprovadas.", rows: [{ label: "Estado", value: "Não implementada", tone: "muted" }], blocker: NO_PUBLISH, downstream: [] } }),
  ];

  const edges: FlowEdgeSpec[] = [
    { id: "e:scope-template", source: "scope", target: "template" },
    { id: "e:template-process", source: "template", target: "process" },
    ...GATES.map((g): FlowEdgeSpec => ({ id: `e:process-${g}`, source: "process", target: `gate:${g}`, active: running, sourceHandle: "b", targetHandle: "t" })),
    ...GATES.map((g): FlowEdgeSpec => ({ id: `e:${g}-judge`, source: `gate:${g}`, target: "judge", active: running, sourceHandle: "b", targetHandle: "t" })),
    { id: "e:judge-pilot", source: "judge", target: "pilot", muted: running, sourceHandle: "b", targetHandle: "t" },
    { id: "e:pilot-publish", source: "pilot", target: "publish", muted: true },
  ];
  return { id: `run:${run.id}`, title: `Execução de ${formatDateTime(run.startedAt)}`, nodes: place(nodes, RUN_POS), edges, mode: running ? "live" : "recorded" };
}
