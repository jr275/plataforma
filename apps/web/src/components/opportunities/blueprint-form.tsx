"use client";

import { useActionState } from "react";
import { Loader2, ClipboardList } from "lucide-react";
import { blueprintAction, type OpportunityActionState } from "@/app/(app)/opportunities/actions";
import { Button } from "@/components/ui/button";

export function BlueprintForm({ opportunityId, enabled, hasBlueprint }: { opportunityId: string; enabled: boolean; hasBlueprint: boolean }) {
  const [state, action, pending] = useActionState<OpportunityActionState, FormData>(blueprintAction, null);
  return (
    <form action={action} noValidate className="space-y-3">
      <input type="hidden" name="opportunityId" value={opportunityId} />
      <Button type="submit" disabled={pending || !enabled} aria-busy={pending}>
        {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <ClipboardList data-icon="inline-start" aria-hidden="true" />}
        {hasBlueprint ? "Reavaliar blueprint" : "Gerar blueprint"}
      </Button>
      {!enabled ? <p className="text-xs text-muted-foreground">O blueprint só pode ser gerado para oportunidades elegíveis (estado “Elegível”, “SERP analisada” ou “Com blueprint”).</p> : <p className="text-xs text-muted-foreground">Monta o plano da página com dados já gravados, avalia os seis gates e, se nenhum reprovar, avança a oportunidade. Nada é publicado.</p>}
      <div aria-live="polite">
        {state?.error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p> : null}
        {state?.ok ? <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{state.ok}</p> : null}
      </div>
    </form>
  );
}
