import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CitiesHomeView } from "@/components/cities/cities-home-view";
import { devCityList } from "@/lib/dev-graph-fixture";
import { CITY_PAGE_SIZE, parseCityParams } from "@/lib/server/cities";

export const metadata: Metadata = { title: "Prévia de cidades (desenvolvimento)" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound(); // só existe em desenvolvimento
  await connection();
  const params = parseCityParams(await searchParams);
  const { rows, total, summary } = devCityList(params, CITY_PAGE_SIZE);
  return <CitiesHomeView loaded={{ state: "ready", data: { cities: { rows, total }, summary }, origin: undefined }} params={params} pageSize={CITY_PAGE_SIZE} />;
}

export default function Page(props: PageProps<"/dev/cities">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
