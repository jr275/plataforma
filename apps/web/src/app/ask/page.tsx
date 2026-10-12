import type { Metadata } from "next";
import { Suspense } from "react";
import { AskView } from "@/components/screens/ask-view";

export const metadata: Metadata = { title: "Ask AI" };

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground">Carregando…</p>}>
      <AskView />
    </Suspense>
  );
}
