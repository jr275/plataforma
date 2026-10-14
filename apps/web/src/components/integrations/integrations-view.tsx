import { engine } from "@plataforma/api";
import { Badge, type Tone } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import type { IntegrationEntry, IntegrationStatus } from "@/lib/server/integrations";

export const STATUS: Record<IntegrationStatus, { label: string; tone: Tone }> = {
  operational: { label: "Operacional (verificado agora)", tone: "success" },
  configured_unverified: { label: "Não verificado agora", tone: "info" },
  not_configured: { label: "Não configurado", tone: "outline" },
  blocked_external: { label: "Bloqueado: depende de terceiros", tone: "danger" },
  error: { label: "Falha agora", tone: "danger" },
};
const CATEGORIES = ["Plataforma", "Fonte de dados", "Publicação e medição"] as const;

export function IntegrationsView({ entries }: { entries: readonly IntegrationEntry[] }) {
  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Integrations" }]} title="Integrations" description="O estado real de cada integração e fonte. Variável presente não é integração operacional: só o que foi verificado agora recebe esse selo." />
      <p role="note" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Nenhum valor de configuração é exibido: apenas os nomes das variáveis e se estão definidas.</p>
      {CATEGORIES.map((cat) => {
        const list = entries.filter((e) => e.category === cat);
        if (list.length === 0) return null;
        return (
          <Panel key={cat} title={cat}>
            <ul className="divide-y divide-border">
              {list.map((e) => (
                <li key={e.id} className="py-3 first:pt-0 last:pb-0" data-testid={`integration-${e.id}`} data-status={e.status}>
                  <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{e.name}</h3><Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge></div>
                  <p className="mt-1 text-xs text-muted-foreground">{e.detail}</p>
                  {e.env.length > 0 ? <p className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">{e.env.map((v) => (<span key={v.name} className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 font-mono"><span aria-hidden="true" className={`size-1.5 rounded-full ${v.set ? "bg-success" : "bg-muted-foreground/50"}`} />{v.name}<span className="sr-only">{v.set ? " (definida)" : " (ausente)"}</span></span>))}</p> : null}
                  {e.dependency ? <p className="mt-1.5 text-xs"><strong>Para destravar:</strong> {e.dependency}</p> : null}
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}
      <Panel title="Capacidades do motor de oportunidades" description="Estado verificável de cada capacidade. Só “implementada e testada” tem adaptador real e testes; as demais não existem e nada as simula.">
        <ul className="divide-y divide-border" data-testid="capabilities">
          {engine.CAPABILITIES.map((c) => (
            <li key={c.id} className="py-3 first:pt-0 last:pb-0" data-capability={c.id} data-state={c.state}>
              <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{c.label}</h3><Badge tone={c.state === "implemented_tested" ? "success" : c.state === "configured_unverified" ? "info" : c.state === "not_implemented" ? "outline" : "danger"}>{engine.CAPABILITY_STATE_LABEL[c.state]}</Badge>{c.contract ? <span className="font-mono text-[10.5px] text-muted-foreground">contrato {c.contract}</span> : null}</div>
              <p className="mt-1 text-xs text-muted-foreground">{c.detail}</p>
              {c.unlocks.length ? <p className="mt-1 text-xs text-muted-foreground">{c.state === "implemented_tested" ? "Mede" : "Passaria a medir"}: {c.unlocks.map((d) => engine.DIMENSION_INFO[d].label).join(", ")}.</p> : null}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
