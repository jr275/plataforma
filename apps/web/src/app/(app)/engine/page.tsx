import type { Metadata } from "next";
import { Suspense } from "react";
import { FactoryOverview } from "@/components/engine/factory-views";
import { loadFactoryOverview } from "@/lib/server/factory";

export const metadata: Metadata = { title: "Programmatic SEO Factory" };
async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).days; const d = Number.parseInt(typeof raw === "string" ? raw : "", 10); const days = [7, 30, 90].includes(d) ? d : 7;
  return <FactoryOverview loaded={await loadFactoryOverview(days)} days={days} />;
}
export default function Page(props: PageProps<"/engine">) { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content searchParams={props.searchParams} /></Suspense>; }
