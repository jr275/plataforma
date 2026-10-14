"use client";

import { X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

/** Diálogo padrão: fecha com Esc, com o botão ou clicando fora. */
export function Modal({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 dark:bg-background/70" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[min(32rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-popover p-5 shadow-xl shadow-foreground/10 dark:shadow-black/40 outline-none transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
          <Dialog.Close aria-label="Fechar" className="absolute top-3 right-3 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <X className="size-4" aria-hidden="true" />
          </Dialog.Close>
          <Dialog.Title className="pr-8 text-base font-semibold tracking-tight">{title}</Dialog.Title>
          {description ? <Dialog.Description className="mt-1 text-sm text-muted-foreground">{description}</Dialog.Description> : null}
          <div className="mt-4">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
