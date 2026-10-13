"use client";

import { useActionState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { reprocessAction, type ReprocessState } from "@/app/(app)/generation/actions";
import { Button } from "@/components/ui/button";

/** Reprocessa esta página: se nada mudou, o resultado é "inalterada" e nenhuma versão nova é criada. */
export function ReprocessForm({ pageId }: { pageId: string }) {
  const [state, action, pending] = useActionState<ReprocessState, FormData>(reprocessAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-1.5">
      <input type="hidden" name="pageId" value={pageId} />
      <Button type="submit" variant="outline" disabled={pending} aria-busy={pending}>
        {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <RefreshCw data-icon="inline-start" aria-hidden="true" />}
        {pending ? "Reprocessando…" : "Reprocessar"}
      </Button>
      {state?.error ? <p role="alert" className="max-w-xs text-xs text-destructive">{state.error}</p> : null}
    </form>
  );
}
