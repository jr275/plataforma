// Estado operacional de ferramentas (capacidades) a partir de EVIDÊNCIA. Módulo puro: sem E/S, sem relógio global (o "agora" é injetado),
// sem segredo (só NOMES de variáveis de ambiente, nunca valores). Nada aqui é "marcado" à mão: o status é derivado.

export const OPERATIONAL_STATUSES = ["WORKING", "DEGRADED", "NOT_WORKING", "NOT_CONFIGURED", "NOT_TESTED", "BLOCKED", "MOCK", "DISABLED", "STALE"] as const;
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number];

/** Como a execução aconteceu. Só `live` e `sandbox` provam funcionamento contra o serviço real; `import` prova um arquivo carregado, não uma sincronização. */
export type ExecutionMode = "live" | "sandbox" | "replay" | "simulated" | "mock" | "import";
export type EvidenceKind = "live_check" | "execution_record" | "import_snapshot" | "test_run";

export interface Evidence {
  /** Identificador rastreável (id da execução, da importação ou do snapshot). */
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly mode: ExecutionMode;
  /** ISO 8601. */
  readonly at: string;
  readonly outcome: "success" | "partial" | "failure" | "blocked";
  readonly errorCode?: string;
  /** Mensagem segura (sem segredo nem dado pessoal). */
  readonly detail?: string;
}

export interface ToolDefinition {
  readonly id: string;
  readonly name: string;
  readonly stage: string;
  readonly provider: string | null;
  readonly capability: string;
  readonly criticality: "critical" | "important" | "supporting";
  /** NOMES de variáveis de ambiente exigidas. Nunca valores. */
  readonly requiresConfig: readonly string[];
  /** Ferramentas das quais esta depende (aresta real de dados). */
  readonly dependsOn: readonly string[];
  /** Janela de frescor: evidência de sucesso mais velha que isso vira STALE. */
  readonly freshMs: number;
  readonly enabled: boolean;
  readonly disabledReason?: string;
}

export interface ToolInput {
  readonly configPresent: ReadonlySet<string>;
  readonly evidence: readonly Evidence[];
}

export interface ToolState {
  readonly id: string;
  readonly status: OperationalStatus;
  readonly reason: string;
  /** Ferramenta que originou o problema (própria ou a raiz de uma cadeia de bloqueio). */
  readonly rootCause: string | null;
  readonly blockedBy: readonly string[];
  readonly evidence: Evidence | null;
  readonly mode: ExecutionMode | null;
}

/** Dependência nesses estados impede a execução da dependente. NOT_TESTED, STALE e DEGRADED não bloqueiam: avisam, não impedem. */
const BLOCKING: ReadonlySet<OperationalStatus> = new Set(["NOT_WORKING", "NOT_CONFIGURED", "BLOCKED", "DISABLED"]);
const MOCK_LIKE: ReadonlySet<ExecutionMode> = new Set(["mock", "simulated", "replay"]);

export function ageLabel(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  return h < 48 ? `${Math.max(h, 0)} h` : `${Math.round(h / 24)} dias`;
}

/** Ordem topológica (dependências primeiro). Ciclo ou dependência desconhecida é erro de definição, nunca ignorado. */
export function topoOrder(defs: readonly ToolDefinition[]): ToolDefinition[] {
  const byId = new Map(defs.map((d) => [d.id, d]));
  if (byId.size !== defs.length) throw new Error("registro com ids de ferramenta repetidos");
  const out: ToolDefinition[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, path: string[]) => {
    const d = byId.get(id);
    if (!d) throw new Error(`dependência desconhecida: ${id} (em ${path.join(" > ")})`);
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error(`ciclo de dependências: ${[...path, id].join(" > ")}`);
    state.set(id, 1);
    for (const dep of d.dependsOn) visit(dep, [...path, id]);
    state.set(id, 2);
    out.push(d);
  };
  for (const d of defs) visit(d.id, []);
  return out;
}

/**
 * Precedência (a primeira regra que casa decide):
 *  1. desabilitada de propósito            → DISABLED
 *  2. configuração obrigatória ausente     → NOT_CONFIGURED (ausente ≠ inválida: aqui só se sabe que falta)
 *  3. a evidência MAIS RECENTE é falha     → NOT_WORKING (uma falha recente nunca é escondida por um sucesso antigo)
 *  4. dependência impede a execução        → BLOCKED (guarda a causa raiz; a dependente não é culpada)
 *  5. sem nenhuma evidência                → NOT_TESTED
 *  6. evidência mais recente é simulada    → MOCK (mock, simulação e replay nunca contam como funcionamento real)
 *  7. sucesso mais velho que a janela      → STALE
 *  8. resultado parcial                    → DEGRADED; bloqueado → BLOCKED
 *  9. sucesso dentro da janela             → WORKING
 */
export function evaluateTool(def: ToolDefinition, input: ToolInput, upstream: ReadonlyMap<string, ToolState>, now: Date): ToolState {
  const base = { id: def.id, blockedBy: [] as string[], evidence: null as Evidence | null, mode: null as ExecutionMode | null };
  if (!def.enabled) return { ...base, status: "DISABLED", reason: def.disabledReason ?? "desabilitada", rootCause: null };

  const missing = def.requiresConfig.filter((n) => !input.configPresent.has(n));
  if (missing.length > 0) return { ...base, status: "NOT_CONFIGURED", reason: `faltam variáveis: ${missing.join(", ")}`, rootCause: def.id };

  const latest = [...input.evidence].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0] ?? null;
  const withEv = { ...base, evidence: latest, mode: latest?.mode ?? null };

  if (latest && latest.outcome === "failure") {
    return { ...withEv, status: "NOT_WORKING", reason: latest.errorCode ? `${latest.errorCode}${latest.detail ? `: ${latest.detail}` : ""}` : (latest.detail ?? "falha registrada"), rootCause: def.id };
  }

  const blockers = def.dependsOn.filter((d) => BLOCKING.has(upstream.get(d)?.status ?? "NOT_TESTED"));
  if (blockers.length > 0) {
    const first = upstream.get(blockers[0]!)!;
    return { ...withEv, status: "BLOCKED", reason: `depende de ${blockers.join(", ")} (${blockers.map((b) => upstream.get(b)!.status).join(", ")})`, rootCause: first.rootCause ?? blockers[0]!, blockedBy: blockers };
  }

  if (!latest) return { ...withEv, status: "NOT_TESTED", reason: "nenhuma evidência registrada", rootCause: null };
  if (MOCK_LIKE.has(latest.mode)) return { ...withEv, status: "MOCK", reason: `última execução foi ${latest.mode}`, rootCause: null };

  const age = now.getTime() - Date.parse(latest.at);
  if (latest.outcome === "success" && age > def.freshMs) return { ...withEv, status: "STALE", reason: `última verificação há ${ageLabel(age)} (janela de ${ageLabel(def.freshMs)})`, rootCause: null };
  if (latest.outcome === "blocked") return { ...withEv, status: "BLOCKED", reason: latest.detail ?? "bloqueada por um fator externo", rootCause: def.id };
  if (latest.outcome === "partial") return { ...withEv, status: "DEGRADED", reason: latest.detail ?? "resultado parcial", rootCause: null };
  return { ...withEv, status: "WORKING", reason: latest.mode === "import" ? "arquivo importado válido (não é sincronização)" : "verificação funcional recente bem-sucedida", rootCause: null };
}

export function evaluateAll(defs: readonly ToolDefinition[], inputs: ReadonlyMap<string, ToolInput>, now: Date): Map<string, ToolState> {
  const out = new Map<string, ToolState>();
  for (const d of topoOrder(defs)) out.set(d.id, evaluateTool(d, inputs.get(d.id) ?? { configPresent: new Set(), evidence: [] }, out, now));
  return out;
}

export interface Ratio { readonly numerator: number; readonly denominator: number; readonly rate: number | null }
const ratio = (n: number, d: number): Ratio => ({ numerator: n, denominator: d, rate: d > 0 ? n / d : null });

export interface OperationalMetrics {
  readonly totalTools: number;
  readonly byStatus: Readonly<Record<OperationalStatus, number>>;
  /** ferramentas WORKING ÷ todas as registradas (desabilitadas entram no denominador: nada é excluído em silêncio). */
  readonly toolVerificationCoverage: Ratio;
  /** o mesmo, só sobre as habilitadas (informado à parte, nunca no lugar do anterior). */
  readonly enabledToolCoverage: Ratio;
  /** etapas em que TODAS as ferramentas habilitadas estão WORKING com execução real (live ou sandbox; importação não conta) ÷ todas as etapas declaradas. */
  readonly stageCoverage: Ratio;
  /** checagens reais (live ou sandbox) bem-sucedidas ÷ checagens reais elegíveis. */
  readonly integrationSuccessRate: Ratio;
  readonly verifiedStages: readonly string[];
  readonly unverifiedStages: readonly string[];
}

export function computeMetrics(defs: readonly ToolDefinition[], stages: readonly string[], states: ReadonlyMap<string, ToolState>, inputs: ReadonlyMap<string, ToolInput>): OperationalMetrics {
  const byStatus = Object.fromEntries(OPERATIONAL_STATUSES.map((s) => [s, 0])) as Record<OperationalStatus, number>;
  for (const d of defs) byStatus[states.get(d.id)!.status]++;
  const enabled = defs.filter((d) => d.enabled);
  const verified: string[] = [];
  const unverified: string[] = [];
  // Etapa verificada exige WORKING com evidência de execução REAL (live ou sandbox). Arquivo importado prova o arquivo, não a etapa.
  const realWorking = (id: string) => { const st = states.get(id)!; return st.status === "WORKING" && (st.mode === "live" || st.mode === "sandbox"); };
  for (const s of stages) {
    const tools = enabled.filter((d) => d.stage === s);
    (tools.length > 0 && tools.every((d) => realWorking(d.id)) ? verified : unverified).push(s);
  }
  let eligible = 0, ok = 0;
  for (const d of defs) for (const e of inputs.get(d.id)?.evidence ?? []) {
    if (e.mode !== "live" && e.mode !== "sandbox") continue;
    if (e.kind !== "live_check" && e.kind !== "execution_record") continue;
    eligible++;
    if (e.outcome === "success") ok++;
  }
  return {
    totalTools: defs.length, byStatus,
    toolVerificationCoverage: ratio(byStatus.WORKING, defs.length),
    enabledToolCoverage: ratio(enabled.filter((d) => states.get(d.id)!.status === "WORKING").length, enabled.length),
    stageCoverage: ratio(verified.length, stages.length),
    integrationSuccessRate: ratio(ok, eligible),
    verifiedStages: verified, unverifiedStages: unverified,
  };
}
