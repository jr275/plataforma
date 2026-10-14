// Registro de andamento do motor de páginas (spec "AI-Native Programmatic SEO Platform"). Quatro situações DISTINTAS por item:
//   implemented: o código existe; verified: há evidência de execução/teste; blocked_external: depende de credencial, dado ou decisão fora do repositório; pending: ainda não feito.
// "Verificado" exige evidência; "bloqueado externamente" exige o bloqueio concreto. Esta é a fonte única: `docs/product/ENGINE_PROGRESS.md` é gerado daqui e o Control Plane a exibe.
export type ProgressState = "implemented" | "verified" | "blocked_external" | "pending";
export interface ProgressItem {
  readonly id: string; readonly increment: number; readonly title: string;
  /** Cada situação é um fato independente: um item pode estar implementado e verificado e, ao mesmo tempo, ter uma parte bloqueada. */
  readonly implemented: boolean; readonly verified: boolean; readonly evidence: string | null;
  readonly blocked: string | null; readonly pending: string | null;
}
export const PROGRESS_LABEL: Record<ProgressState, string> = { implemented: "Implementado", verified: "Verificado", blocked_external: "Bloqueado externamente", pending: "Pendente" };

export const ENGINE_PROGRESS: readonly ProgressItem[] = [
  { id: "inc1-data-layer", increment: 1, title: "Entidade, fato bi-temporal, política versionada e catálogo de atributos", implemented: true, verified: true, evidence: "test:schema + catalog.product.test.ts; piloto local: 645 municípios, UF/região/população VALID", blocked: "Bairros, POIs e anúncios: sem fonte real (R12)", pending: null },
  { id: "inc2-topics", increment: 2, title: "Geração e persistência de tópicos (identidade determinística, deduplicação por tenant)", implemented: true, verified: true, evidence: "topics.product.test.ts (645 tópicos de SP, idempotência, isolamento) e generate.test.ts", blocked: "Tópicos de bairro/tipologia: sem entidades nem atributos com dados", pending: "Agente 2 (propostas): o validador existe; a chamada real depende de ANTHROPIC_API_KEY" },
  { id: "inc3-combination", increment: 3, title: "Combination Engine: expansão controlada, compatibilidade, poda, redundância pai–filho e motivos persistidos", implemented: true, verified: true, evidence: "engine.test.ts (18 casos, 9 mutações detectadas) e combination.product.test.ts com dados reais de SP: 10 raízes, pares podados em F4 (1 atributo comparável < 3), log persistido", blocked: "Famílias de tipologia × lugar e long tail: sem entidades de bairro/anúncio; demanda: sem fonte (tudo segue como hipótese)", pending: "Agente 4 (revisão semântica de redundância): contrato previsto na camada de agentes (Inc. 5)" },
];

export function renderProgressMarkdown(items: readonly ProgressItem[]): string {
  const yn = (b: boolean) => (b ? "sim" : "não");
  const rows = items.map((i) => `| ${i.increment} | ${i.title} | ${yn(i.implemented)} | ${yn(i.verified)} | ${i.evidence ?? "—"} | ${i.blocked ?? "—"} | ${i.pending ?? "—"} |`).join("\n");
  return `# Andamento do motor de páginas (gerado de \`packages/api/src/engine/progress.ts\`: não edite à mão)\n\nQuatro situações DISTINTAS por item. "Verificado" exige evidência; "bloqueado externamente" exige o bloqueio concreto.\n\n| Inc. | Item | Implementado | Verificado | Evidência | Bloqueado externamente | Pendente |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows}\n`;
}
