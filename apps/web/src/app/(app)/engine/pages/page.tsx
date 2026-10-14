import type { Metadata } from "next";
import { Suspense } from "react";
import { PagesView } from "@/components/engine/factory-views";
import { PAGE_SIZE, loadPages, parsePageParams } from "@/lib/server/factory";

export const metadata: Metadata = { title: "Páginas" };
async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { const p = parsePageParams(await searchParams); return <PagesView loaded={await loadPages(p)} params={p} pageSize={PAGE_SIZE} />; }
export default function Page(props: PageProps<"/engine/pages">) { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content searchParams={props.searchParams} /></Suspense>; }
