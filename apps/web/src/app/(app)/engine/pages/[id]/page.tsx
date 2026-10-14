import type { Metadata } from "next";
import { Suspense } from "react";
import { factory } from "@plataforma/api";
import { PageDetailView, type PreviewDocs } from "@/components/engine/factory-views";
import { loadPageDetail } from "@/lib/server/factory";

export const metadata: Metadata = { title: "Página" };
async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params; const sp = await searchParams; const loaded = await loadPageDetail(id);
  let preview: PreviewDocs | null = null; let diff: ReturnType<typeof factory.diffRecipes> | null = null; const versions = { a: null as number | null, b: null as number | null };
  if (loaded.state === "ready" && loaded.data && loaded.data.recipes[0]) {
    const rec = loaded.data.recipes[0].recipe; const doc = factory.renderRecipeDocument(rec);
    preview = { clean: doc.html, annotated: factory.renderRecipeDocument(rec, { annotate: true }).html, doc };
    const a = Number.parseInt(typeof sp.a === "string" ? sp.a : "", 10); const b = Number.parseInt(typeof sp.b === "string" ? sp.b : "", 10);
    const ra = loaded.data.recipes.find((x) => x.version === a); const rb = loaded.data.recipes.find((x) => x.version === b);
    if (ra && rb) { diff = factory.diffRecipes(ra.recipe, rb.recipe); versions.a = a; versions.b = b; }
  }
  return <PageDetailView loaded={loaded} preview={preview} diff={diff} versions={versions} />;
}
export default function Page(props: PageProps<"/engine/pages/[id]">) { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content params={props.params} searchParams={props.searchParams} /></Suspense>; }
