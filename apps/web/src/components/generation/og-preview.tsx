import { Panel } from "@/components/ui/panel";

/** Prévia da imagem Open Graph (gerada sob demanda com next/og a partir do título e da cidade). Não é guardada nem publicada. */
export function OgPreview({ src, title }: { src: string; title: string }) {
  return (
    <Panel title="Imagem de compartilhamento (OG)" description="Gerada na hora com o título desta versão. Só uma prévia: nada é publicado.">
      {/* Imagem dinâmica e autenticada: não passa pelo otimizador de imagens do Next. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} width={1200} height={630} alt={`Imagem de compartilhamento: ${title}`} loading="lazy" className="aspect-[1200/630] w-full rounded-md border border-border bg-muted object-cover" />
    </Panel>
  );
}
