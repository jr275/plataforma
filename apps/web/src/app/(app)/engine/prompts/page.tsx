import type { Metadata } from "next";
import { Suspense } from "react";
import { PromptVersionsView } from "@/components/engine/engine-views";
import { loadPromptVersions } from "@/lib/server/engine-runtime";

export const metadata: Metadata = { title: "Versões de prompt" };
async function Content() { return <PromptVersionsView loaded={await loadPromptVersions()} />; }
export default function Page() { return <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}><Content /></Suspense>; }
