import type { ReactNode } from "react";
import { Badge, type Tone } from "./badge";

// Vocabulário ÚNICO de verdade dos dados na interface (contrato de modo + base das informações). Nenhuma tela inventa outro rótulo.
export type TruthState = "live" | "demo" | "derived" | "estimated" | "not_evaluated" | "blocked" | "unavailable";
export const TRUTH: Record<TruthState, { label: string; tone: Tone; hint: string }> = {
  live: { label: "live", tone: "success", hint: "Dado real, lido ou coletado de uma fonte registrada." },
  demo: { label: "demo", tone: "warning", hint: "Dado fictício de demonstração: não é do tenant nem de nenhuma integração." },
  derived: { label: "derived", tone: "info", hint: "Calculado pelo sistema a partir de dados reais, com a regra explicada." },
  estimated: { label: "estimated", tone: "warning", hint: "Estimativa ou inferência: não foi medida." },
  not_evaluated: { label: "not evaluated", tone: "outline", hint: "A verificação não foi feita (falta fonte): não é aprovação nem reprovação." },
  blocked: { label: "blocked", tone: "danger", hint: "Depende de credencial, contrato ou decisão que ainda não existe." },
  unavailable: { label: "unavailable", tone: "outline", hint: "Sem dado: nunca é tratado como zero nem como evidência negativa." },
};
/** Base da informação (engine/truth) → estado de verdade da interface. */
export function truthOfBasis(basis: string): TruthState {
  if (basis === "observed" || basis === "provider_metric") return "live";
  if (basis === "derived") return "derived";
  if (basis === "inferred" || basis === "estimated") return "estimated";
  return "unavailable";
}
export function TruthChip({ state, children }: { state: TruthState; children?: ReactNode }) {
  const t = TRUTH[state];
  return <span title={t.hint}><Badge tone={t.tone}>{children ?? t.label}</Badge></span>;
}
/** Legenda recolhível: o que cada selo significa. */
export function TruthLegend() {
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none underline-offset-2 hover:underline focus-visible:underline">Legenda dos selos de verdade</summary>
      <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {(Object.keys(TRUTH) as TruthState[]).map((k) => (<div key={k} className="flex items-baseline gap-2"><dt><TruthChip state={k} /></dt><dd>{TRUTH[k].hint}</dd></div>))}
      </dl>
    </details>
  );
}
