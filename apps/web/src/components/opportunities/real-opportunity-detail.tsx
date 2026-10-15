import Link from "next/link";
import type { Opportunity } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import type { Loaded } from "@/lib/server/tenant-data";
import { OpportunityStatusControls } from "./status-controls";
import { INTENT_LABEL, KIND_LABEL, LEVEL_LABEL, LEVEL_TONE, OpportunityStatePanel, STATUS_LABEL, STATUS_TONE } from "./real-opportunities-view";

// Detalhe de uma oportunidade REAL. A mudança de status é uma ação de servidor (actions.ts), revalidada contra o estado atual.

const FACTORS = [
  { key: "demand", label: "Demanda", help: "Quanto o universo de buscas pede por este tema." },
  { key: "competition", label: "Concorrência", help: "Quão bem atendido o tema já é por outros resultados." },
  { key: "evidence", label: "Evidência", help: "Quanto do conteúdo pode se apoiar em fatos com fonte." },
] as const;

const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

const BackLink = () => <Link href="/opportunities" className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-3`}>Voltar para as oportunidades</Link>;

export function RealOpportunityDetail({ loaded }: { loaded: Loaded<Opportunity | null> }) {
  if (loaded.state !== "ready") {
    return (
      <div className="space-y-6">
        <OpportunityStatePanel state={loaded.state} {...(loaded.state === "not_configured" ? { missing: loaded.missing } : {})} />
        <BackLink />
      </div>
    );
  }
  const o = loaded.data;
  if (!o) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-center">
        <p className="text-sm font-medium">Oportunidade não encontrada</p>
        <p className="max-w-sm text-xs text-muted-foreground">O link pode estar desatualizado ou a oportunidade não existe neste workspace.</p>
        <BackLink />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Opportunities", href: "/opportunities" }, { label: o.title }]}
        title={o.title}
        description={o.summary}
        badges={<><Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge><Badge tone="outline">{KIND_LABEL[o.kind]}</Badge><Badge tone="outline">{INTENT_LABEL[o.intent]}</Badge></>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        {FACTORS.map((f) => (
          <Panel key={f.key} title={f.label} description={f.help}>
            <Badge tone={LEVEL_TONE[o[f.key]]}>{LEVEL_LABEL[o[f.key]]}</Badge>
          </Panel>
        ))}
      </div>
      <Panel title="Próxima ação"><p className="text-sm">{o.nextAction}</p></Panel>
      <Panel title="Decisão" description="Mude o status da oportunidade. O servidor confere se a mudança é válida a partir do estado atual.">
        <OpportunityStatusControls id={o.id} status={o.status} />
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Por que esta oportunidade">
          {o.rationale.length === 0 ? <EmptyState title="Sem justificativa registrada" /> : <ul className="list-disc space-y-1 pl-5 text-sm">{o.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </Panel>
        <Panel title="O que falta saber">
          {o.gaps.length === 0 ? <EmptyState title="Nenhuma lacuna registrada" /> : <ul className="list-disc space-y-1 pl-5 text-sm">{o.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>}
        </Panel>
      </div>
      <p className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">
        Ordem editorial {o.rank} · criada em {dateFmt.format(o.createdAt)} · atualizada em {dateFmt.format(o.updatedAt)}
      </p>
    </div>
  );
}
