import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { RoadmapView } from "@/components/opportunities/roadmap-view";
import { devOpportunities } from "@/lib/dev-opportunity-fixture";
import { activeVertical, verticalMeta } from "@/lib/server/vertical";

export const metadata: Metadata = { title: "Prévia do roadmap (desenvolvimento)" };

async function Content() {
  if (process.env.NODE_ENV === "production") notFound(); // só existe em desenvolvimento
  await connection();
  const { roadmap } = await devOpportunities();
  return <><p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs">Caso de teste: a vertical imobiliária foi ajustada em dois pontos (padrão “city-overview” de valor alto e valor comercial mínimo 30) só para existir um caminho “pronta para construir”. Com os padrões reais da vertical, nenhuma oportunidade passa dos bloqueios.</p><RoadmapView loaded={{ state: "ready", data: roadmap, origin: undefined }} intents={activeVertical.intents.map((i) => ({ id: i.id, label: i.label }))} vertical={verticalMeta} detailBase="/dev/opportunities" listBase="/dev/opportunities" /></>;
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content />
    </Suspense>
  );
}
