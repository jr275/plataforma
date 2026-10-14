"use client";

import { useActionState } from "react";
import { Loader2, Search } from "lucide-react";
import { researchAction, type ResearchState } from "@/app/(app)/opportunities/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { RUN_STATUS, formatInt } from "@/components/generation/format";
import { ADAPTER_LABEL } from "./format";

/** Pesquisa REAL: consulta as fontes públicas agora, grava e mostra o resultado de cada fonte. Nada é simulado. */
export function ResearchForm() {
  const [state, action, pending] = useActionState<ResearchState, FormData>(researchAction, null);
  const r = state?.result;
  return (
    <div className="space-y-4">
      <form action={action} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-64">
          <Field id="research-entities" label="Cidades a considerar" hint="As de maior população (1 a 100)." error={state?.fieldError}>
            <input id="research-entities" name="entities" inputMode="numeric" defaultValue="20" aria-invalid={state?.fieldError ? true : undefined} aria-describedby={state?.fieldError ? "research-entities-error" : undefined} className={inputClass} />
          </Field>
        </div>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <Search data-icon="inline-start" aria-hidden="true" />}
          {pending ? "Consultando as fontes…" : "Iniciar pesquisa"}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">Consulta agora o Banco Central, as notícias do IBGE e o feed da Agência Brasil (respeitando robots.txt), grava a evidência com fonte e data, gera as hipóteses da vertical e calcula o score. Leva de segundos a cerca de um minuto. Demanda de busca não é medida: ela aparece como desconhecida.</p>
      <div aria-live="polite">
        {state?.error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p> : null}
        {r ? (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm" data-testid="research-result">
            <p className="flex items-center gap-2 font-medium">Pesquisa {RUN_STATUS[r.status].label.toLowerCase()} <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>{r.error ? <span className="text-destructive">{r.error}</span> : null}</p>
            <ul className="space-y-1 text-xs">
              {r.adapters.map((a) => (
                <li key={a.adapter}><strong>{ADAPTER_LABEL[a.adapter] ?? a.adapter}</strong>: {a.status === "succeeded" ? "ok" : a.status === "partial" ? "parcial" : a.status === "skipped" ? "ignorada" : "falhou"} · {a.requests} requisição(ões) · {formatInt(a.kept)} registro(s) guardado(s), {formatInt(a.inserted)} novo(s){a.errors.length ? ` · erros: ${a.errors.map((e) => `${e.target} (${e.code})`).join(", ")}` : ""}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Evidência: {r.evidence.inserted} nova(s), {r.evidence.existing} já existente(s) · Oportunidades: {r.opportunities.created} nova(s), {r.opportunities.existing} já existente(s), {r.opportunities.rejected} rejeitada(s) · Scores novos: {r.scores.inserted} · Transições: {r.transitions}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
