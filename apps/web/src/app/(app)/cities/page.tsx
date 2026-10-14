import type { Metadata } from "next";
import { Suspense } from "react";
import { CitiesHomeView } from "@/components/cities/cities-home-view";
import { CITY_PAGE_SIZE, loadCities, parseCityParams } from "@/lib/server/cities";

export const metadata: Metadata = { title: "Cidades" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = parseCityParams(await searchParams);
  return <CitiesHomeView loaded={await loadCities(params)} params={params} pageSize={CITY_PAGE_SIZE} />;
}

export default function Page(props: PageProps<"/cities">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
