import type { Metadata } from "next";
import { Suspense } from "react";
import { CityDetailView } from "@/components/cities/city-detail-view";
import { loadCityDetail } from "@/lib/server/cities";

export const metadata: Metadata = { title: "Cidade" };

async function CityContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CityDetailView loaded={await loadCityDetail(id)} />;
}

export default function Page(props: PageProps<"/cities/[id]">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <CityContent params={props.params} />
    </Suspense>
  );
}
