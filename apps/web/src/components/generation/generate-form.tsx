"use client";

import { useActionState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { generateAction, type GenerateFormState } from "@/app/(app)/generation/actions";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";

/** Formulário real de geração: valida no servidor, mostra erro por campo e erro geral, e leva à execução criada. */
export function GenerateForm({ ufs }: { ufs: readonly string[] }) {
  const [state, action, pending] = useActionState<GenerateFormState, FormData>(generateAction, null);
  return (
    <form action={action} noValidate className="space-y-4" aria-describedby={state?.error ? "gen-error" : undefined}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="gen-uf" label="UF" hint="Seleciona as cidades de maior população da UF." error={state?.fieldErrors?.uf}>
          <select id="gen-uf" name="uf" defaultValue="SP" aria-invalid={state?.fieldErrors?.uf ? true : undefined} aria-describedby={state?.fieldErrors?.uf ? "gen-uf-error" : undefined} className={inputClass}>
            {ufs.map((u) => (<option key={u} value={u}>{u}</option>))}
          </select>
        </Field>
        <Field id="gen-limit" label="Quantidade de cidades" hint="De 1 a 500. O piloto usa 20 (mínimo de 10 para o aceite do lote)." error={state?.fieldErrors?.limit}>
          <input id="gen-limit" name="limit" inputMode="numeric" defaultValue="20" aria-invalid={state?.fieldErrors?.limit ? true : undefined} aria-describedby={state?.fieldErrors?.limit ? "gen-limit-error" : undefined} className={inputClass} />
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">Template: <strong>city-overview v1</strong> (conteúdo vindo só de fatos do IBGE; não há campos editáveis). As páginas ficam como <strong>rascunho</strong>; nada é publicado.</p>
      {state?.error ? <p id="gen-error" role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
        {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <Sparkles data-icon="inline-start" aria-hidden="true" />}
        {pending ? "Gerando…" : "Gerar rascunhos"}
      </Button>
    </form>
  );
}
