import { Suspense } from "react";
import Link from "next/link";
import { loadOpportunityDetail } from "@/lib/server/opportunities";
import { SerpWorkspace } from "@/components/intelligence/serp-workspace";
import { StatePanel } from "@/components/generation/state-panel";
export const metadata = { title: "Investigar SERP" };
async function Content({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; const loaded = await loadOpportunityDetail(id); if (loaded.state !== "ready") return <StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} />; const o = loaded.data.detail; if (!o) return <div><h1 className="text-xl font-semibold">Oportunidade não encontrada</h1><Link className="mt-4 block underline" href="/opportunities">Voltar à descoberta</Link></div>; return <SerpWorkspace query={o.primaryQuery} location={o.entity ? `${o.entity.name}, ${o.entity.uf}` : o.country} opportunity={{ id: o.id, intent: o.intent, variants: o.variants, evidenceCount: o.evidence.length }} />; }
export default function Page(props: { params: Promise<{ id: string }> }) { return <Suspense fallback={<p role="status">Carregando investigação…</p>}><Content {...props} /></Suspense>; }
