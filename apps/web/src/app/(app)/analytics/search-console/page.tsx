import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchExportView } from "@/components/analytics/search-export-view";
import { loadGscExport } from "@/lib/server/gsc-export";

export const metadata: Metadata = { title: "Search Console: desempenho", description: "Desempenho orgânico real, lido de um export do Search Console." };

async function Content() {
  return <SearchExportView loaded={await loadGscExport()} />;
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content />
    </Suspense>
  );
}
