import type { Metadata } from "next";
import { Suspense } from "react";
import { EligibilityInspectorView } from "@/components/engine/engine-views";
import { loadEligibility } from "@/lib/server/engine-runtime";

export const metadata: Metadata = { title: "Inspetor de elegibilidade" };
async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams; const decision = typeof raw.decision === "string" ? raw.decision : "";
  return <EligibilityInspectorView loaded={await loadEligibility(decision, "")} decision={decision} />;
}
export default function Page(props: PageProps<"/engine/eligibility">) { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content searchParams={props.searchParams} /></Suspense>; }
