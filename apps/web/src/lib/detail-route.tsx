import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { listWorkspaceData } from "@/data/source";
import type { WorkspaceData } from "@/data/demo/types";

type Params = Promise<{ id: string }>;

/**
 * Fábrica das rotas de detalhe (`/<área>/[id]`): todas pré-geradas a partir das fixtures, com `params` lido só dentro de um
 * Suspense para a casca continuar instantânea. O registro inexistente é tratado pelo próprio componente (estado "não encontrado").
 */
export function detailRoute(opts: { label: string; ids: (all: readonly WorkspaceData[]) => string[]; title: (all: readonly WorkspaceData[], id: string) => string | undefined; render: (id: string) => ReactNode }) {
  async function generateStaticParams() {
    const all = await listWorkspaceData();
    return [...new Set(opts.ids(all))].map((id) => ({ id }));
  }
  async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
    const { id } = await params;
    return { title: opts.title(await listWorkspaceData(), id) ?? opts.label };
  }
  async function Detail({ params }: { params: Params }) {
    const { id } = await params;
    return <>{opts.render(id)}</>;
  }
  function Page({ params }: { params: Params }) {
    return (
      <Suspense fallback={<p className="py-10 text-sm text-muted-foreground">Carregando…</p>}>
        <Detail params={params} />
      </Suspense>
    );
  }
  return { generateStaticParams, generateMetadata, Page };
}
