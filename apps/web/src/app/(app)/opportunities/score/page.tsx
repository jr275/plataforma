import type { Metadata } from "next";
import { Suspense } from "react";
import { ScoreConfigView } from "@/components/opportunities/score-config-view";
import { loadScoreConfigs } from "@/lib/server/opportunities";
import { activeVertical } from "@/lib/server/vertical";

export const metadata: Metadata = { title: "Configuração do score" };

async function Content() {
  return <ScoreConfigView loaded={await loadScoreConfigs()} vertical={{ id: activeVertical.id, name: activeVertical.name, defaults: activeVertical.scoring, language: activeVertical.language, country: activeVertical.country }} />;
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content />
    </Suspense>
  );
}
