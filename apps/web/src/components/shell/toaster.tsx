"use client";

import { Check, X } from "lucide-react";
import { useAppState } from "@/components/app-state";

export function Toaster() {
  const { toasts, dismissToast } = useAppState();
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-popover px-3 py-2.5 text-sm shadow-lg shadow-black/30">
          <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <p className="min-w-0 flex-1">{t.message}</p>
          <button type="button" onClick={() => dismissToast(t.id)} aria-label="Fechar aviso" className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
