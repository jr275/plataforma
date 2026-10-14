"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { rescoreAction, transitionAction, type OpportunityActionState } from "@/app/(app)/opportunities/actions";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";

function Feedback({ state }: { state: OpportunityActionState }) {
  return (
    <div aria-live="polite">
      {state?.error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p> : null}
      {state?.ok ? <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{state.ok}</p> : null}
    </div>
  );
}

/** Move a oportunidade UM passo no ciclo de vida. Só as transições permitidas aparecem; o servidor valida de novo e o banco também. */
export function TransitionForm({ opportunityId, from, options }: { opportunityId: string; from: string; options: readonly { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<OpportunityActionState, FormData>(transitionAction, null);
  if (options.length === 0) return <p className="text-xs text-muted-foreground">Não há decisão manual possível neste estado (as próximas etapas são registradas pelos fluxos que as realizam).</p>;
  return (
    <form action={action} noValidate className="space-y-3">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <input type="hidden" name="from" value={from} />
      <div className="space-y-3">
        <Field id="tr-to" label="Registrar como"><select id="tr-to" name="to" className={inputClass} defaultValue={options[0]!.value}>{options.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}</select></Field>
        <Field id="tr-reason" label="Motivo (fica no histórico)"><input id="tr-reason" name="reason" required minLength={3} maxLength={1000} placeholder="Ex.: fora do foco deste trimestre" className={inputClass} /></Field>
        <Button type="submit" disabled={pending} aria-busy={pending}>{pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : null}Registrar</Button>
        <p className="text-xs text-muted-foreground">Etapas que afirmam trabalho feito (SERP, blueprint, dados, publicação) são registradas pelo fluxo que as realiza, não à mão.</p>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function RescoreForm({ opportunityId, versions }: { opportunityId: string; versions: readonly { version: number; note: string | null }[] }) {
  const [state, action, pending] = useActionState<OpportunityActionState, FormData>(rescoreAction, null);
  return (
    <form action={action} noValidate className="space-y-3">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-72"><Field id="rs-version" label="Reavaliar com a configuração"><select id="rs-version" name="configVersion" className={inputClass} defaultValue={versions[0]?.version}>{versions.map((v) => (<option key={v.version} value={v.version}>v{v.version}{v.note ? `: ${v.note.slice(0, 40)}` : ""}</option>))}</select></Field></div>
        <Button type="submit" variant="outline" disabled={pending || versions.length === 0} aria-busy={pending}>{pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : null}Recalcular</Button>
      </div>
      <p className="text-xs text-muted-foreground">Cria um novo score com a versão escolhida, reaproveitando as dimensões já medidas. O score anterior permanece no histórico.</p>
      <Feedback state={state} />
    </form>
  );
}
