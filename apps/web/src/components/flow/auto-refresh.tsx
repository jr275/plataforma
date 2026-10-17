"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Atualização REAL de uma execução em andamento: reconsulta os dados no servidor (router.refresh) enquanto `active` for verdadeiro e a aba
 * estiver visível. Não anima nada por conta própria: se o servidor não devolver estado novo, a tela não muda. Para sozinha quando a
 * execução termina (o servidor deixa de pedir `active`).
 */
export function AutoRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const tick = () => { if (document.visibilityState === "visible") router.refresh(); };
    const id = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [active, intervalMs, router]);
  return null;
}
