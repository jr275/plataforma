import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { withTenant } from "@plataforma/api";
import { BlueprintView } from "@/components/opportunities/blueprint-view";
import { devEditorContext } from "@/lib/server/dev-editor";
import { blueprintPageData } from "@/lib/server/opportunities";
import { verticalMeta } from "@/lib/server/vertical";
import { devEvaluateDraftAction, devGeneratePageAction, devPreviewDraftAction, devSaveDraftAction } from "../editor-actions";

export const metadata: Metadata = { title: "Bancada do editor (desenvolvimento)" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound(); // só existe em desenvolvimento
  await connection();
  const c = devEditorContext();
  if (!c) return <p role="note" className="rounded-lg border border-border p-4 text-sm">A bancada precisa de um banco descartável: rode <code>bash scripts/dev-editor.sh</code> (ele define PLATAFORMA_DEV_EDITOR_DATABASE_URL e PLATAFORMA_DEV_EDITOR_TENANT).</p>;
  const q = await searchParams;
  const data = await withTenant(c.pool, c.identity, c.tenantId, async (db) => {
    let id = typeof q.id === "string" ? q.id : "";
    if (!id) id = (await db.query<{ opportunity_id: string }>(`SELECT opportunity_id FROM plataforma.page_blueprint ORDER BY created_at LIMIT 1`)).rows[0]?.opportunity_id ?? "";
    return id ? { id, page: await blueprintPageData(db, id) } : null;
  });
  if (!data) return <p role="note" className="rounded-lg border border-border p-4 text-sm">Nenhum blueprint na bancada: a semente não gerou uma oportunidade com template.</p>;
  return <BlueprintView loaded={{ state: "ready", data: data.page, origin: { kind: "local", host: "socket local (banco descartável)" } }} vertical={verticalMeta} harness="dev" listBase="/dev/opportunities" editorActions={{ save: devSaveDraftAction, evaluate: devEvaluateDraftAction, preview: devPreviewDraftAction }} generate={devGeneratePageAction} />;
}

export default function Page(props: PageProps<"/dev/editor">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
