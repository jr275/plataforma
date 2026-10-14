"use client";

import { X } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { useAppState } from "@/components/app-state";
import { SidebarContent } from "./sidebar-nav";

/** Navegação em gaveta para telas abaixo de `lg`. */
export function NavDrawer() {
  const { navOpen, setNavOpen } = useAppState();
  return (
    <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px] transition-opacity dark:bg-background/70 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 lg:hidden" />
        <Dialog.Popup className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl outline-none transition-transform data-[ending-style]:-translate-x-full data-[starting-style]:-translate-x-full lg:hidden">
          <Dialog.Title className="sr-only">Navegação</Dialog.Title>
          <Dialog.Close aria-label="Fechar navegação" className="absolute top-3 right-3 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <X className="size-4" aria-hidden="true" />
          </Dialog.Close>
          <SidebarContent onNavigate={() => setNavOpen(false)} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
