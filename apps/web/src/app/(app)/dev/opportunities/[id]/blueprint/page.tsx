import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { BlueprintView } from "@/components/opportunities/blueprint-view";
import { devOpportunities } from "@/lib/dev-opportunity-fixture";
import { summarize } from "@/lib/server/opportunities";
import { verticalMeta } from "@/lib/server/vertical";
import { evaluateDraftAction, previewDraftAction, saveDraftAction } from "../../../../opportunities/draft-actions";

export const metadata: Metadata = { title: "Prévia de blueprint (desenvolvimento)" };

async function Content({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  await connection();
  const { id } = await params;
  const { details, blueprints, previews } = await devOpportunities();
  const detail = details.get(id) ?? null;
  const bps = blueprints.get(id) ?? [];
  return <BlueprintView loaded={{ state: "ready", data: { detail, configs: [], blueprints: bps, preview: previews.get(id) ?? null, editor: { unavailable: "Prévia de fixture (sem banco): o editor com persistência real está em /dev/editor, sobre um banco descartável." }, ...summarize(detail, bps) }, origin: undefined }} vertical={verticalMeta} editorActions={{ save: saveDraftAction, evaluate: evaluateDraftAction, preview: previewDraftAction }} listBase="/dev/opportunities" />;
}

export default function Page(props: PageProps<"/dev/opportunities/[id]/blueprint">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content params={props.params} />
    </Suspense>
  );
}
