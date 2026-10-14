import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { draftToBlueprint, executionStates, validateDraft } from "@plataforma/api/src/draft";
import { evaluateExperienceGates } from "@plataforma/api/src/engine/experience-gates";
import { fixtureBlueprint, fixtureDraft, testCtx } from "@/lib/editor/test-fixture";
import { PageEditor, type EditorActions } from "./page-editor";
import { HistoryPanel, IssuesPanel, NodeList, PreviewPane } from "./panels";

// Renderização no servidor do editor (o canvas do React Flow só monta no navegador; as interações são provadas pelo estado puro e na verificação no navegador).
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const no = async () => ({ ok: false as const, kind: "error" as const, message: "x" });
const actions: EditorActions = { save: no, evaluate: no, preview: no };
const props = () => { const d = fixtureDraft(); const b = fixtureBlueprint(); const c = testCtx(); return { opportunityId: "o", ctx: c, base: b, actions, initial: { draft: d, version: 0, evaluation: { validation: validateDraft(d, c), gates: evaluateExperienceGates(draftToBlueprint(d, b, c)) }, versions: [] } }; };

describe("editor: estrutura, estados e alternativa acessível", () => {
  it("barra de ações, estado de salvamento, canvas, inspector vazio, aviso de que nada é publicado e painéis", () => {
    const out = html(<PageEditor {...props()} />);
    for (const t of ["Desfazer", "Refazer", "Adicionar nó", "Organizar (ELK)", "Ajustar à tela", "Validar no servidor", "Salvar rascunho"]) expect(out).toContain(t);
    expect(out).toContain('data-testid="save-status"');
    expect(out).toContain("Sem alterações · sem versão salva");
    expect(out).toContain("Selecione um nó no canvas ou na lista");
    expect(out).toContain("não gera, não indexa e não publica");
    expect(out).toContain("não existe mecanismo de publicação");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Salvar rascunho/); // sem alterações: nada a salvar
    expect(out).toMatch(/<button[^>]*disabled[^>]*aria-label="Desfazer"|aria-label="Desfazer"[^>]*disabled/);
    expect(out).toContain("Fonte de dados"); // tipos adicionáveis vêm do contrato
    expect(out).not.toContain("Decisão de publicação</option>");
    expect(out).not.toContain("Quality gate</option>");
  });
  it("lista de nós (teclado/leitor de tela) tem os 20 nós com estado e as conexões, com ação por nó", () => {
    const d = fixtureDraft(); const b = fixtureBlueprint(); const c = testCtx();
    
    const exec = executionStates(d, c, draftToBlueprint(d, b, c), null, false);
    const out = html(<NodeList draft={d} exec={exec} validity={validateDraft(d, c).nodeValidity} selected={null} onSelect={() => undefined} onRemoveEdge={() => undefined} />);
    expect((out.match(/Inspecionar/g) ?? []).length).toBe(d.nodes.length);
    expect(out).toContain(`Conexões (${d.edges.length})`);
    expect(out).toContain("não avaliado"); // gates sem avaliação do servidor
    expect(out).toContain("bloqueado"); // publicação
  });
  it("validação: contagem, aviso de que gates só valem após validar, e invalidação explícita", () => {
    const d = fixtureDraft(); const c = testCtx(); const v = validateDraft(d, c);
    const fresh = html(<IssuesPanel issues={v.issues} stale={false} evaluatedAt="server" errors={v.errors} warnings={v.warnings} onFocus={() => undefined} />);
    expect(fresh).toContain("gates avaliados para este conteúdo");
    const stale = html(<IssuesPanel issues={v.issues} stale evaluatedAt="server" errors={v.errors} warnings={v.warnings} onFocus={() => undefined} />);
    expect(stale).toContain("gates invalidados pela edição");
    expect(html(<IssuesPanel issues={[]} stale={false} evaluatedAt="never" errors={0} warnings={0} onFocus={() => undefined} />)).toContain("Nenhum problema");
  });
  it("histórico e prévia: estados vazios honestos; rascunho nunca se passa por publicado", () => {
    expect(html(<HistoryPanel versions={[]} />)).toContain("Nenhuma versão salva ainda");
    expect(html(<HistoryPanel versions={[{ version: 2, createdAt: new Date("2026-10-14T12:00:00Z"), createdBy: "abcdefgh1234", valid: false, errors: 2, warnings: 0, changes: [{ kind: "field_changed", id: "page_section-1", field: "order" }], note: null }]} />)).toContain("2 erro(s)");
    expect(html(<PreviewPane preview={undefined} stale={false} pending={false} error={null} onRefresh={() => undefined} />)).toContain("Clique em “Atualizar prévia”");
    expect(html(<PreviewPane preview={null} stale={false} pending={false} error={null} onRefresh={() => undefined} />)).toContain("Nada foi simulado");
    const out = html(<PreviewPane preview={{ status: "no_template", outcome: null, gates: [], page: null, source: null, seo: null, structuredData: [], links: { configured: 0, emitted: 0, missing: [] }, note: "Prévia de RASCUNHO: x." }} stale pending={false} error="falha" onRefresh={() => undefined} />);
    expect(out).toContain("Sem template válido");
    expect(out).toContain("rascunho · não indexável");
    expect(out).toContain("prévia desatualizada");
    expect(out).toContain("falha");
  });
});
