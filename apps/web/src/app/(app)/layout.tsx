import type { ReactNode } from "react";
import { AuthProvider } from "@/components/auth/auth-provider";
import { AppShell } from "@/components/shell/app-shell";

/** Tudo que usa a casca da aplicação (sidebar, topo, estado do protótipo). A tela de login fica fora, em `(auth)`. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
