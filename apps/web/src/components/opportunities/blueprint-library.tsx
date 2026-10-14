import Link from "next/link";
import type { engine as E } from "@plataforma/api";
import type { Loaded } from "@/lib/server/tenant-data";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { StatePanel } from "@/components/generation/state-panel";
import { statusLabel } from "./status";
export function BlueprintLibrary({ loaded }: { loaded: Loaded<E.Roadmap> }) {
 const header = <PageHeader crumbs={[{ label: "Fábrica de experiências" }, { label: "Blueprints" }]} title="Blueprints de página" description="Planos vinculados às oportunidades: requisitos, contrato de renderização, evidências e seis gates." actions={<Link href="/templates" className="rounded-md border border-border px-3 py-2 text-xs hover:bg-accent">Explorar templates</Link>} />;
 if (loaded.state !== "ready") return <div className="space-y-6">{header}<StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} /></div>;
 const items = Object.values(loaded.data.items).flat().filter((o) => o.blueprintVersion !== null);
 return <div className="space-y-6">{header}<Panel title="Biblioteca de planos" description="Planos presentes na seleção prioritária do roadmap. A lista completa está em Descoberta.">{items.length ? <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((o) => <li key={o.id}><Link href={`/opportunities/${o.id}/blueprint`} className="block h-full rounded-lg border border-border p-4 hover:bg-accent"><div className="flex justify-between text-[10px] text-muted-foreground"><span>{statusLabel(o.status)}</span><span>v{o.blueprintVersion}</span></div><h2 className="mt-3 text-sm font-semibold">{o.query}</h2><p className="mt-2 text-xs text-muted-foreground">{o.experience}</p><p className="mt-4 border-t border-border pt-3 text-xs">{o.blockerLabels[0] ?? "Abrir editor e revisar gates"} →</p></Link></li>)}</ul> : <EmptyState title="Nenhum blueprint nesta seleção" hint="Abra uma oportunidade elegível para gerar seu plano a partir dos dados existentes." action={<Link href="/opportunities?eligible=yes" className="text-sm underline">Ver oportunidades elegíveis</Link>} />}</Panel><Link href="/opportunities?status=blueprinted" className="text-xs underline underline-offset-4">Todas as oportunidades no estado Com blueprint</Link></div>;
}
