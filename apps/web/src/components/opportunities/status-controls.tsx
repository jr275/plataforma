"use client";

import { useActionState } from "react";
import type { OpportunityStatus } from "@plataforma/api";
import { Button } from "@/components/ui/button";
import { TRANSITIONS } from "@/lib/opportunity-transitions";
import { changeStatusAction, type OpportunityStatusState } from "@/app/(app)/opportunities/actions";

/** Ações de status da oportunidade real. Só mostra as transições válidas; o servidor revalida tudo. */
export function OpportunityStatusControls({ id, status }: { id: string; status: OpportunityStatus }) {
  const [state, action, pending] = useActionState<OpportunityStatusState, FormData>(changeStatusAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-2">
        {TRANSITIONS[status].map((t) => (
          <Button key={t.to} type="submit" name="to" value={t.to} disabled={pending} variant={t.tone === "primary" ? "default" : "outline"} size="sm">
            {t.label}
          </Button>
        ))}
      </div>
      <p role="status" aria-live="polite" className={state?.error ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {pending ? "Salvando…" : (state?.error ?? state?.done ?? "Descartar é reversível: a oportunidade pode ser restaurada.")}
      </p>
    </form>
  );
}
