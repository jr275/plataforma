import type { Metadata } from "next";
import { Suspense } from "react";
import { BlueprintView } from "@/components/opportunities/blueprint-view";
import { evaluateDraftAction, previewDraftAction, saveDraftAction } from "../../draft-actions";
import { loadBlueprintPage } from "@/lib/server/opportunities";
import { verticalMeta } from "@/lib/server/vertical";

export const metadata: Metadata = { title: "Blueprint da experiência" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BlueprintView loaded={await loadBlueprintPage(id)} vertical={verticalMeta} editorActions={{ save: saveDraftAction, evaluate: evaluateDraftAction, preview: previewDraftAction }} />;
}

export default function Page(props: PageProps<"/opportunities/[id]/blueprint">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content params={props.params} />
    </Suspense>
  );
}
