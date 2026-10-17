import type { PageBlock } from "@plataforma/api";
import { siteStyle } from "@/lib/site/tokens";
import { renderBlock, type LinkMode } from "./blocks";

/**
 * Exibe blocos JÁ calculados e validados. Seguro para componentes de cliente: só importa TIPOS do pacote da API (o código de execução
 * do pacote arrasta o driver do banco para o navegador). Quem calcula os blocos é o servidor (`SitePage` ou a página que o chama).
 * Falha fechada: com erros de validação mostra o motivo e NÃO a página. `@container` faz o layout reagir à largura do quadro.
 */
export function SiteView({ blocks, errors, linkMode = "preview" }: { blocks: readonly PageBlock[]; errors: readonly string[]; linkMode?: LinkMode }) {
  if (errors.length > 0) {
    return (
      <div role="alert" data-testid="site-blocked" className="bg-white px-6 py-8 text-sm text-neutral-900">
        <p className="font-semibold">Página bloqueada pelo catálogo de blocos</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">{errors.map((e) => (<li key={e}>{e}</li>))}</ul>
      </div>
    );
  }
  return (
    <article data-testid="rendered-article" className="@container bg-[color:var(--site-bg)] px-5 py-6 @xl:px-10 @xl:py-10" style={siteStyle}>
      {blocks.map((b, i) => renderBlock(b, i, linkMode))}
    </article>
  );
}
