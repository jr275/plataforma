import type { Metadata } from "next";
import { Suspense } from "react";
import { BlueprintStudio } from "@/components/blueprints/blueprint-studio";

export const metadata: Metadata = { title: "Page Blueprints" };

export default function BlueprintsPage() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground">Carregando blueprint…</p>}>
      <BlueprintStudio />
    </Suspense>
  );
}
