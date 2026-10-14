"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { saveConfigAction, type ConfigState } from "@/app/(app)/opportunities/actions";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";

export interface ConfigFormModel {
  objectives: { id: string; label: string; weight: number; minCoverage: number; dimensions: { id: string; label: string; weight: number }[] }[];
  eligibility: { minCommercialValue: number; minExecutionFeasibility: number; maxEvidenceRisk: number; maxCannibalizationRisk: number; requireStrategicOrDemand: boolean };
  uncertaintyFactor: number;
}

/** Editor de configuração: cria uma NOVA versão (as antigas ficam). Validação no servidor; erro aparece por campo. */
export function ScoreConfigForm({ model }: { model: ConfigFormModel }) {
  const [state, action, pending] = useActionState<ConfigState, FormData>(saveConfigAction, null);
  const fe = state?.fieldErrors ?? {};
  const f = (name: string, label: string, value: number, hint?: string) => (
    <Field key={name} id={`cfg-${name}`} label={label} hint={hint} error={fe[name]}><input id={`cfg-${name}`} name={name} inputMode="decimal" defaultValue={String(value)} aria-invalid={fe[name] ? true : undefined} aria-describedby={fe[name] ? `cfg-${name}-error` : undefined} className={inputClass} /></Field>
  );
  return (
    <form action={action} noValidate className="space-y-6">
      {model.objectives.map((o) => (
        <fieldset key={o.id} className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 font-mono text-[11px] tracking-wide uppercase">{o.label}</legend>
          <div className="grid gap-3 sm:grid-cols-2">{f(`obj.${o.id}.weight`, "Peso na prioridade geral", o.weight)}{f(`obj.${o.id}.minCoverage`, "Cobertura mínima (0 a 1)", o.minCoverage, "Fração dos pesos com dado para o objetivo existir.")}</div>
          <div className="grid gap-3 sm:grid-cols-3">{o.dimensions.map((d) => f(`dim.${o.id}.${d.id}`, d.label, d.weight))}</div>
        </fieldset>
      ))}
      <fieldset className="space-y-3 rounded-lg border border-border p-3">
        <legend className="px-1 font-mono text-[11px] tracking-wide uppercase">Elegibilidade e incerteza</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {f("elig.minCommercialValue", "Valor comercial mínimo", model.eligibility.minCommercialValue)}{f("elig.minExecutionFeasibility", "Viabilidade mínima", model.eligibility.minExecutionFeasibility)}
          {f("elig.maxEvidenceRisk", "Risco de evidência máximo (0 a 1)", model.eligibility.maxEvidenceRisk)}{f("elig.maxCannibalizationRisk", "Canibalização máxima (0 a 1)", model.eligibility.maxCannibalizationRisk)}
          {f("uncertaintyFactor", "Fator de incerteza (0 a 1)", model.uncertaintyFactor, "Quanto a incerteza reduz cada objetivo.")}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="elig.requireStrategicOrDemand" defaultChecked={model.eligibility.requireStrategicOrDemand} className="size-4" /> Exigir demanda medida ou justificativa estratégica da vertical</label>
      </fieldset>
      <Field id="cfg-note" label="Nota da versão (opcional)"><input id="cfg-note" name="note" maxLength={300} placeholder="Ex.: mais peso à viabilidade" className={inputClass} /></Field>
      <div aria-live="polite">
        {state?.error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p> : null}
        {state?.ok ? <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{state.ok}</p> : null}
      </div>
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>{pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : null}Salvar como nova versão</Button>
    </form>
  );
}
