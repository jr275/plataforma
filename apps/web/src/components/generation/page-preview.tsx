"use client";

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import type { RenderedPage } from "@plataforma/api";
import { cn } from "@/lib/utils";
import { RenderedArticle } from "./rendered-article";

type Device = "desktop" | "mobile";

/** Pré-visualização renderizada, com moldura de navegador e alternância desktop/celular. É só uma PRÉVIA: nada aqui está publicado. */
export function PagePreview({ page }: { page: RenderedPage }) {
  const [device, setDevice] = useState<Device>("desktop");
  const btn = (d: Device, label: string, Icon: typeof Monitor) => (
    <button
      type="button"
      aria-pressed={device === d}
      onClick={() => setDevice(d)}
      className={cn("inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", device === d ? "border-brand/40 bg-brand/15 text-brand" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </button>
  );
  return (
    <section aria-label="Pré-visualização da página" className="border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="font-mono text-[11px] font-semibold tracking-[0.08em] uppercase">Pré-visualização</h2>
        <div className="flex gap-1.5" role="group" aria-label="Tamanho da tela">{btn("desktop", "Desktop", Monitor)}{btn("mobile", "Celular", Smartphone)}</div>
      </header>
      <div className="bg-muted/50 p-3 sm:p-5">
        <div className={cn("mx-auto w-full overflow-hidden rounded-lg border border-border bg-white shadow-sm transition-[max-width] duration-200", device === "mobile" ? "max-w-[390px]" : "max-w-[860px]")} data-device={device}>
          <div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-100 px-3 py-2">
            <span aria-hidden="true" className="flex gap-1"><i className="size-2.5 rounded-full bg-neutral-300" /><i className="size-2.5 rounded-full bg-neutral-300" /><i className="size-2.5 rounded-full bg-neutral-300" /></span>
            <span className="min-w-0 flex-1 truncate rounded bg-white px-2 py-0.5 font-mono text-[11px] text-neutral-600" title="Caminho da URL; o domínio será definido na publicação">{page.path}</span>
          </div>
          <RenderedArticle page={page} />
        </div>
      </div>
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Prévia do conteúdo gerado. Esta página <strong>não está publicada</strong> nem indexável.</p>
    </section>
  );
}
