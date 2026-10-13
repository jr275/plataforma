import type { Metadata } from "next";
import { Suspense } from "react";
import { RunDetailView } from "@/components/generation/run-detail-view";
import { loadRunDetail } from "@/lib/server/generation";

export const metadata: Metadata = { title: "Execução de geração" };

async function RunContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunDetailView loaded={await loadRunDetail(id)} />;
}

export default function Page(props: PageProps<"/generation/runs/[id]">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <RunContent params={props.params} />
    </Suspense>
  );
}
