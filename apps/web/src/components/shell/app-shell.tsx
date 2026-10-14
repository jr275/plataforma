import type { ReactNode } from "react";
import { AppStateProvider } from "@/components/app-state";
import { DEFAULT_WORKSPACE_ID, listWorkspaceData } from "@/data/source";
import { Suspense } from "react";
import { CommandPalette } from "./command-palette";
import { ModeBannerByRoute } from "./mode-banner";
import { NavDrawer } from "./nav-drawer";
import { Sidebar } from "./sidebar-nav";
import { Toaster } from "./toaster";
import { Topbar } from "./topbar";

/** Casca da aplicação: sidebar, topbar e estado compartilhado. As páginas só preenchem `children`. */
export async function AppShell({ children }: { children: ReactNode }) {
  const workspaces = await listWorkspaceData();
  return (
    <AppStateProvider base={workspaces} initialId={DEFAULT_WORKSPACE_ID}>
      <a href="#conteudo" className="sr-only z-[80] rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Ir para o conteúdo
      </a>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main id="conteudo" className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <Suspense fallback={null}><ModeBannerByRoute /></Suspense>
            {children}
          </main>
        </div>
      </div>
      <NavDrawer />
      <CommandPalette />
      <Toaster />
    </AppStateProvider>
  );
}
