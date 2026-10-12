import type { Metadata } from "next";
import { Suspense } from "react";
import { OpportunitiesView } from "@/components/opportunities/opportunities-view";

export const metadata: Metadata = { title: "Opportunities" };

export default function OpportunitiesPage() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground">Carregando oportunidades…</p>}>
      <OpportunitiesView />
    </Suspense>
  );
}
