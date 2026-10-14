import type { Metadata } from "next";
import { Suspense } from "react";
import { PageDetailView } from "@/components/generation/page-detail-view";
import { loadPageDetail, parseVersionParam } from "@/lib/server/generation";

export const metadata: Metadata = { title: "Página gerada" };

async function PageContent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const v = parseVersionParam(sp.v);
  return <PageDetailView loaded={await loadPageDetail(id)} version={v.kind === "ok" ? v.version : undefined} invalidVersion={v.kind === "invalid"} />;
}

export default function Page(props: PageProps<"/generation/pages/[id]">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <PageContent params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
