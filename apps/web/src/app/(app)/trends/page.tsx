import type { Metadata } from "next";
import { Suspense } from "react";
import { TrendsView } from "@/components/opportunities/trends-view";
import { loadTrends } from "@/lib/server/opportunities";
import { verticalMeta } from "@/lib/server/vertical";

export const metadata: Metadata = { title: "Tendências e notícias" };

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const one = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  const kind = ["indicator", "news_item"].includes(one("kind")) ? one("kind") : "";
  const adapter = ["bcb-sgs", "ibge-news", "rss-news"].includes(one("adapter")) ? one("adapter") : "";
  return <TrendsView loaded={await loadTrends({ kind: kind || undefined, adapter: adapter || undefined })} filters={{ kind, adapter, q: one("q").slice(0, 100), location: one("location").slice(0, 100), days: ["7", "30", "90"].includes(one("days")) ? one("days") : "" }} vertical={verticalMeta} />;
}

export default function Page(props: PageProps<"/trends">) {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}
