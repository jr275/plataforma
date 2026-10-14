import Link from "next/link";
import type { engine as E } from "@plataforma/api";
import { Badge, type Tone } from "@/components/ui/badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { formatDateTime } from "@/components/generation/format";
import { BlueprintForm } from "./blueprint-form";

export const OUTCOME: Record<E.Outcome, { label: string; tone: Tone }> = { pass: { label: "passou", tone: "success" }, fail: { label: "reprovou", tone: "danger" }, warning: { label: "aviso", tone: "warning" }, not_evaluated: { label: "não avaliado", tone: "outline" } };
export const GATE_LABEL: Record<E.GateId, string> = { business: "Negócio", knowledge: "Conhecimento", experience: "Experiência", search: "Busca", geo: "GEO", technical: "Técnico" };

/** Resumo do blueprint na página da oportunidade: o que existe, os seis gates em uma linha e o caminho para o detalhe completo. */
export function BlueprintPanel({ opportunityId, blueprints, canCreate, serpWaiver, detailHref }: { opportunityId: string; blueprints: readonly E.BlueprintRecord[]; canCreate: boolean; serpWaiver: E.SerpWaiver | null; detailHref: string }) {
  const latest = blueprints[0];
  return (
    <Panel title="Blueprint e quality gate" description={latest ? `Versão ${latest.version} · ${formatDateTime(latest.createdAt)} · ${latest.ready ? "nenhum gate reprovou" : "com bloqueios"}` : "Ainda não há blueprint para esta oportunidade."}
      action={latest ? <Link href={detailHref} className="inline-flex h-7 items-center rounded-lg border border-border px-2.5 text-xs hover:bg-muted">Abrir blueprint completo</Link> : undefined}>
      <div className="space-y-4">
        <BlueprintForm opportunityId={opportunityId} enabled={canCreate} hasBlueprint={Boolean(latest)} />
        {!latest ? <EmptyState title="Sem blueprint" hint="Gere o blueprint para ver o template, os dados disponíveis e o resultado dos gates." /> : (
          <>
            <ul className="flex flex-wrap gap-2" aria-label="Resultado dos seis gates">
              {latest.report.gates.map((g) => (<li key={g.gate} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"><span className="font-medium">{GATE_LABEL[g.gate]}</span><Badge tone={OUTCOME[g.outcome].tone}>{OUTCOME[g.outcome].label}</Badge></li>))}
            </ul>
            <p className="text-xs text-muted-foreground">Template: {latest.blueprint.template.status === "selected" ? `${latest.blueprint.template.key} v${latest.blueprint.template.version}` : "inexistente para esta experiência"} · {latest.report.blockers.length} bloqueio(s) · {latest.report.gates.flatMap((g) => g.checks).filter((c) => c.outcome === "not_evaluated").length} verificação(ões) não avaliada(s)</p>
            {serpWaiver && !serpWaiver.reviewed ? <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs"><strong>Exceção de SERP vigente</strong> (por {serpWaiver.actor.slice(0, 8)}, {formatDateTime(serpWaiver.at)}): {serpWaiver.reason}. Não autoriza publicação; revisar quando houver um provedor de SERP.</p> : null}
          </>
        )}
      </div>
    </Panel>
  );
}
