import { Suspense } from "react";
import { SerpWorkspace } from "@/components/intelligence/serp-workspace";
export const metadata = { title: "SERP Explorer" };
async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { const raw = await searchParams; return <SerpWorkspace query={typeof raw.q === "string" ? raw.q.slice(0, 160) : ""} location={typeof raw.location === "string" ? raw.location.slice(0, 100) : ""} />; }
export default function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <Suspense fallback={<p role="status">Carregando contexto…</p>}><Content {...props} /></Suspense>; }
