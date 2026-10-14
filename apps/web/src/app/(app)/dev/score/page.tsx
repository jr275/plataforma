import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ScoreConfigView } from "@/components/opportunities/score-config-view";
import { activeVertical } from "@/lib/server/vertical";

export const metadata: Metadata = { title: "Prévia da configuração do score (desenvolvimento)" };

async function Content() {
  if (process.env.NODE_ENV === "production") notFound(); // só existe em desenvolvimento
  await connection();
  return <ScoreConfigView loaded={{ state: "ready", data: { configs: [] }, origin: undefined }} vertical={{ id: activeVertical.id, name: activeVertical.name, defaults: activeVertical.scoring, language: activeVertical.language, country: activeVertical.country }} />;
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content />
    </Suspense>
  );
}
