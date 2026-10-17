import { toBlocks, validateBlocks, type RenderedPage } from "@plataforma/api";
import { SiteView } from "./site-view";
import type { LinkMode } from "./blocks";

/**
 * SOMENTE SERVIDOR: converte a página em blocos do catálogo (ADR-040), valida e entrega ao `SiteView`. Não importe este arquivo em um
 * componente de cliente (veja `client-boundary.test.ts`): calcule os blocos no servidor e passe-os como dados.
 */
export function SitePage({ page, linkMode = "preview" }: { page: RenderedPage; linkMode?: LinkMode }) {
  const blocks = toBlocks(page);
  return <SiteView blocks={blocks} errors={validateBlocks(blocks)} linkMode={linkMode} />;
}
