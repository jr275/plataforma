import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchUniverseView } from "@/components/screens/search-universe-view";

export const metadata: Metadata = { title: "Search Universe" };

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground">Carregando…</p>}>
      <SearchUniverseView />
    </Suspense>
  );
}
