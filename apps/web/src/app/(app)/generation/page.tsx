import type { Metadata } from "next";
import { Suspense } from "react";
import { GenerationHomeView } from "@/components/generation/generation-home-view";
import { PAGE_SIZE, loadGenerationHome, parseHomeParams } from "@/lib/server/generation";

export const metadata: Metadata = { title: "Geração de páginas" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseHomeParams(await searchParams);
  return <GenerationHomeView loaded={await loadGenerationHome(params)} params={params} pageSize={PAGE_SIZE} />;
}

export default function Page(props: PageProps<"/generation">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
