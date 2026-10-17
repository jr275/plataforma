import type { Metadata } from "next";
import { Suspense } from "react";
import { OperationsView } from "@/components/operations/operations-view";
import { loadOperations } from "@/lib/server/operations";

export const metadata: Metadata = { title: "Operações", description: "Estado real das ferramentas e etapas, derivado de evidência." };

async function Content() {
  return <OperationsView data={await loadOperations()} />;
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content />
    </Suspense>
  );
}
