"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { routeMode, type RouteMode } from "@/config/navigation";

const COPY: Record<Exclude<RouteMode, "real">, { title: string; text: string; tone: string }> = {
  reference: { title: "Capacidade", text: "Contratos e disponibilidade do produto. Esta tela não contém medições de provedores.", tone: "border-border bg-muted/30" },
  demo: { title: "Demonstração", text: "Os dados desta tela são fictícios e ficam só neste navegador. Não são do tenant autenticado, de nenhum banco nem de nenhuma integração.", tone: "border-warning/40 bg-warning/10" },
  dev: { title: "Fixture de desenvolvimento", text: "Dados reais do IBGE montados em memória, sem banco nem login. Esta rota não existe em produção.", tone: "border-info/30 bg-info/10" },
};

/** Faixa fixa no topo do conteúdo: uma tela que não é dado real NUNCA pode ser confundida com o tenant real. */
export function ModeBanner({ mode }: { mode: RouteMode }) {
  if (mode === "real") return null;
  const c = COPY[mode];
  return (
    <div role="note" data-testid="mode-banner" data-mode={mode} className={`mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs ${c.tone}`}>
      <strong className="font-mono text-[10.5px] tracking-[0.08em] uppercase">{c.title}</strong>
      <span className="text-muted-foreground">{c.text}</span>
      {mode === "demo" ? <Link href="/cities" className="ml-auto underline underline-offset-2">Ver telas com dado real</Link> : null}
    </div>
  );
}

export function ModeBannerByRoute() {
  return <ModeBanner mode={routeMode(usePathname())} />;
}
