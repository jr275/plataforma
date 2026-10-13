"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Keyboard, LogOut, RotateCcw, Settings } from "lucide-react";
import { Menu } from "@base-ui/react/menu";
import { useAppState } from "@/components/app-state";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

const item = "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[highlighted]:bg-accent";

/** Menu do usuário do protótipo. Não há autenticação: o "usuário demo" é só um rótulo local. */
export function UserMenu({ onPrimary = false }: { onPrimary?: boolean }) {
  const router = useRouter();
  const { prefs, resetDemo, notify } = useAppState();
  const auth = useAuth();
  const [shortcuts, setShortcuts] = useState(false);
  const [reset, setReset] = useState(false);
  const initials = prefs.displayName.trim().slice(0, 1).toUpperCase() || "U";
  return (
    <>
      <Menu.Root>
        <Menu.Trigger aria-label={`Menu de ${prefs.displayName}`} className={`grid size-8 place-items-center text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${onPrimary ? "bg-white text-primary hover:bg-white/85" : "bg-secondary hover:bg-accent data-[popup-open]:bg-accent"}`}>
          {initials}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} align="end" className="z-[70]">
            <Menu.Popup className="min-w-60 rounded-lg border border-border bg-popover p-1 text-sm shadow-xl shadow-black/40 outline-none">
              <div className="px-2 py-1.5">
                <p className="truncate text-[13px] font-medium">{prefs.displayName}</p>
                <p className="truncate text-[11px] text-muted-foreground">{auth.configured ? (auth.email ?? "Sessão ativa") : "Modo demonstração, sem login"}</p>
              </div>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Item className={item} onClick={() => router.push("/settings")}>
                <Settings className="size-4 text-muted-foreground" aria-hidden="true" /> Configurações
              </Menu.Item>
              <Menu.Item className={item} onClick={() => setShortcuts(true)}>
                <Keyboard className="size-4 text-muted-foreground" aria-hidden="true" /> Atalhos de teclado
              </Menu.Item>
              {auth.configured ? (
                <Menu.Item className={item} onClick={() => void auth.signOut()}>
                  <LogOut className="size-4 text-muted-foreground" aria-hidden="true" /> Sair
                </Menu.Item>
              ) : null}
              <Menu.Item className={item} onClick={() => setReset(true)}>
                <RotateCcw className="size-4 text-muted-foreground" aria-hidden="true" /> Redefinir dados de demonstração
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Modal open={shortcuts} onOpenChange={setShortcuts} title="Atalhos de teclado">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt>Buscar ou executar um comando</dt><dd><kbd className="rounded border border-border px-1.5 font-mono text-xs">⌘K / Ctrl+K</kbd></dd></div>
          <div className="flex justify-between"><dt>Fechar diálogos e menus</dt><dd><kbd className="rounded border border-border px-1.5 font-mono text-xs">Esc</kbd></dd></div>
          <div className="flex justify-between"><dt>Navegar nos resultados da busca</dt><dd><kbd className="rounded border border-border px-1.5 font-mono text-xs">↑ ↓ ↵</kbd></dd></div>
        </dl>
      </Modal>
      <Modal open={reset} onOpenChange={setReset} title="Redefinir dados de demonstração?" description="Apaga as alterações feitas neste navegador (estados, conversas, execuções e fontes simuladas). As preferências são mantidas. Nada externo é afetado.">
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setReset(false)}>Cancelar</Button>
          <Button onClick={() => { resetDemo(); setReset(false); notify("Dados de demonstração redefinidos."); }}>Redefinir</Button>
        </div>
      </Modal>
    </>
  );
}
