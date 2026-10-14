"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, FilePlus2 } from "lucide-react";
import type { engine } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/editor/types";
import type { GenerateDTO } from "@/lib/server/draft-service";
import { formatDateTime } from "@/components/generation/format";

export type GenerateAction = (input: { opportunityId: string }) => Promise<ActionResult<GenerateDTO>>;
type Pages = { readonly rows: readonly engine.OpportunityPageRecord[] } | { readonly unavailable: string };
const OUTCOME_LABEL = { generated: "nova versão", unchanged: "sem mudança", blocked: "reprovada nos gates" } as const;

/** Gerar o rascunho da página a partir do blueprint (pipeline existente). Mostra o resultado, os gates da PÁGINA e o histórico. Nunca publica. */
export function GeneratePanel({ opportunityId, enabled, why, pages, generate, linkBase }: { opportunityId: string; enabled: boolean; why?: string; pages: Pages; generate?: GenerateAction; linkBase?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<GenerateDTO> | null>(null);
  const run = () => { if (!generate) return; start(async () => { const r = await generate({ opportunityId }); setResult(r); if (r.ok) router.refresh(); }); };
  const rows = "rows" in pages ? pages.rows : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={run} disabled={pending || !enabled || !generate} aria-busy={pending}>
          {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : <FilePlus2 data-icon="inline-start" aria-hidden="true" />}
          {rows.length > 0 ? "Gerar de novo" : "Gerar rascunho da página"}
        </Button>
        <p className="max-w-xl text-xs text-muted-foreground">{!generate ? "Indisponível nesta prévia." : enabled ? "Usa o pipeline de geração existente, o blueprint e o rascunho salvo no editor. A página fica em rascunho (noindex); nada é publicado." : why}</p>
      </div>
      <div aria-live="polite">
        {result && !result.ok ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{result.message}</p> : null}
        {result?.ok ? (
          <div role="status" className="space-y-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <p><strong>{result.data.qaPassed ? "QA aprovado" : "QA reprovado"}</strong> · {OUTCOME_LABEL[result.data.outcome]}{result.data.usedDraftVersion ? ` · rascunho do editor v${result.data.usedDraftVersion}` : ""}</p>
            {result.data.steps.length > 0 ? <ul className="list-disc pl-5 text-xs text-muted-foreground">{result.data.steps.map((s, i) => <li key={i}>{s.from} → {s.to}: {s.reason}</li>)}</ul> : <p className="text-xs text-muted-foreground">O estado não mudou (já estava em QA).</p>}
            <p className="text-xs text-muted-foreground">{result.data.note}</p>
          </div>
        ) : null}
      </div>
      {"unavailable" in pages ? <p role="note" className="text-sm text-muted-foreground">{pages.unavailable}</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum rascunho gerado ainda para esta oportunidade.</p> : (
        <ul className="divide-y divide-border border border-border" aria-label="Rascunhos gerados">
          {rows.map((r) => (
            <li key={r.id} className="space-y-2 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={r.qaPassed ? "success" : "danger"}>{r.qaPassed ? "QA aprovado" : "QA reprovado"}</Badge>
                <span>{OUTCOME_LABEL[r.outcome]}{r.version ? ` · versão ${r.version}` : ""}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                {r.pageId && linkBase ? <Link href={`${linkBase}/${r.pageId}`} className="text-xs underline">Abrir em Geração{r.path ? ` (${r.path})` : ""}</Link> : null}
              </div>
              <ul className="grid gap-1 sm:grid-cols-2" aria-label="Gates da página">
                {r.gates.map((g) => (
                  <li key={g.gate} className="flex items-start gap-2 text-xs"><Badge tone={g.outcome === "pass" ? "success" : g.outcome === "fail" ? "danger" : "outline"}>{g.outcome === "pass" ? "ok" : g.outcome === "fail" ? "falhou" : "pulado"}</Badge><span><span className="font-mono">{g.gate}</span> — {g.detail}</span></li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
