import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { TrendsView } from "@/components/opportunities/trends-view";
import { devOpportunities } from "@/lib/dev-opportunity-fixture";
import { verticalMeta } from "@/lib/server/vertical";

export const metadata: Metadata = { title: "Prévia de tendências (desenvolvimento)" };

async function Content() {
  if (process.env.NODE_ENV === "production") notFound(); // só existe em desenvolvimento
  await connection();
  const { evidence, runs } = await devOpportunities();
  return <TrendsView loaded={{ state: "ready", data: { evidence, runs }, origin: undefined }} filters={{ kind: "", adapter: "" }} vertical={verticalMeta} now={new Date("2026-10-14T12:00:00Z")} />;
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-10 text-sm text-muted-foreground" role="status">Carregando…</p>}>
      <Content />
    </Suspense>
  );
}
