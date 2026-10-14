"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { serpWaiverAction, type OpportunityActionState } from "@/app/(app)/opportunities/actions";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";

/** Exceção ESCRITA da etapa SERP (ADR-025): só com blueprint pronto, com motivo e confirmação. Não é autorização de publicação. */
export function SerpWaiverForm({ opportunityId, enabled, why }: { opportunityId: string; enabled: boolean; why?: string }) {
  const [state, action, pending] = useActionState<OpportunityActionState, FormData>(serpWaiverAction, null);
  return (
    <form action={action} noValidate className="space-y-3">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <Field id="waiver-reason" label="Motivo da exceção (fica no histórico, com autor e horário)" hint="Ex.: nenhum provedor de SERP contratado; revisar quando houver.">
        <textarea id="waiver-reason" name="reason" rows={3} minLength={10} maxLength={1000} disabled={!enabled} className={`${inputClass} h-auto py-2`} />
      </Field>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="ack" disabled={!enabled} className="mt-0.5 size-4" /><span>Entendo que a SERP ficará <strong>não avaliada</strong>, que a exceção <strong>não autoriza publicar</strong> e que ela deve ser revisada quando houver um provedor de SERP.</span></label>
      <Button type="submit" variant="outline" disabled={pending || !enabled} aria-busy={pending}>{pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : null}Registrar exceção e avançar</Button>
      {!enabled && why ? <p className="text-xs text-muted-foreground">{why}</p> : null}
      <div aria-live="polite">
        {state?.error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p> : null}
        {state?.ok ? <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{state.ok}</p> : null}
      </div>
    </form>
  );
}
