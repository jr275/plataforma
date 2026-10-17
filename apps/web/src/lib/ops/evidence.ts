import type { OperationalEvidence as Evidence, ExecutionMode } from "@plataforma/api";

// Converte registros REAIS de execução (importação, geração) em evidência. Módulo puro. Execução ainda em andamento não é evidência
// terminal e é ignorada; uma mensagem de erro nunca sai sem passar pela redação (URLs de conexão, tokens e e-mails).

export interface RunLike {
  readonly id: string;
  readonly status: "running" | "succeeded" | "partial" | "failed";
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly error: string | null;
}

/** Remove de uma mensagem o que parece credencial: URL de conexão, sequência longa de caracteres de token e endereço de e-mail. */
export function redact(text: string, max = 160): string {
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "[url]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]")
    .replace(/\b[A-Za-z0-9_\-+/=]{32,}\b/g, "[token]")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

export function runEvidence(prefix: string, runs: readonly RunLike[], mode: (r: RunLike) => ExecutionMode = () => "live"): Evidence[] {
  const out: Evidence[] = [];
  for (const r of runs) {
    if (r.status === "running") continue;
    const at = (r.finishedAt ?? r.startedAt).toISOString();
    const base = { id: `${prefix}:${r.id}`, kind: "execution_record" as const, mode: mode(r), at };
    if (r.status === "succeeded") out.push({ ...base, outcome: "success" });
    else if (r.status === "partial") out.push({ ...base, outcome: "partial", detail: r.error ? redact(r.error) : "execução parcial: parte dos itens falhou" });
    else out.push({ ...base, outcome: "failure", errorCode: "RUN_FAILED", detail: r.error ? redact(r.error) : "execução falhou sem mensagem registrada" });
  }
  return out;
}

/** Origem da importação → modo de execução: dados reais, dados de teste (simulados) ou carga manual de arquivo (importação). */
export const importMode = (origin: "real" | "test" | "manual"): ExecutionMode => (origin === "real" ? "live" : origin === "test" ? "simulated" : "import");
