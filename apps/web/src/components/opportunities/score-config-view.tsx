import Link from "next/link";
import { engine, type engine as E } from "@plataforma/api";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { formatDateTime } from "@/components/generation/format";
import { StatePanel } from "@/components/generation/state-panel";
import type { ScoreConfigData } from "@/lib/server/opportunities";
import type { Loaded } from "@/lib/server/tenant-data";
import { OBJECTIVE_LABEL } from "./format";
import { ScoreConfigForm, type ConfigFormModel } from "./score-config-form";
import type { VerticalMeta } from "./opportunities-home-view";
import { VerticalContext } from "./vertical-context";

export function toFormModel(c: E.ScoreConfig): ConfigFormModel {
  return {
    objectives: engine.OBJECTIVES.map((o) => ({ id: o, label: OBJECTIVE_LABEL[o], weight: c.objectives[o].weight, minCoverage: c.objectives[o].minCoverage, dimensions: Object.entries(c.objectives[o].dimensions).map(([id, weight]) => ({ id, label: engine.DIMENSION_INFO[id as E.DimensionId].label, weight: weight as number })) })),
    eligibility: { minCommercialValue: c.eligibility.minCommercialValue, minExecutionFeasibility: c.eligibility.minExecutionFeasibility, maxEvidenceRisk: c.eligibility.maxEvidenceRisk, maxCannibalizationRisk: c.eligibility.maxCannibalizationRisk, requireStrategicOrDemand: c.eligibility.requireStrategicOrDemand },
    uncertaintyFactor: c.uncertaintyFactor,
  };
}

export function ScoreConfigView({ loaded, vertical }: { loaded: Loaded<ScoreConfigData>; vertical: { id: string; name: string; defaults: E.ScoreConfig } & Partial<VerticalMeta> }) {
  const header = <PageHeader crumbs={[{ label: "Oportunidades", href: "/opportunities" }, { label: "Configuração do score" }]} badges={vertical.language ? <VerticalContext name={vertical.name} language={vertical.language} country={vertical.country ?? ""} /> : undefined} title="Configuração do score" description={`Pesos, cobertura mínima e limites de elegibilidade da vertical “${vertical.name}”. Cada mudança cria uma nova versão; scores antigos mantêm a versão com que foram calculados.`} />;
  if (loaded.state !== "ready") return <div className="space-y-6">{header}<StatePanel state={loaded.state} missing={loaded.state === "not_configured" ? loaded.missing : undefined} /></div>;
  const configs = loaded.data.configs;
  const active = configs[0];
  const current = active?.config ?? vertical.defaults;
  return (
    <div className="space-y-6">
      {header}
      <Panel title={active ? `Versão ativa: v${active.version}` : "Ainda não há versão gravada"} description={active ? `Criada em ${formatDateTime(active.createdAt)}${active.note ? ` — ${active.note}` : ""}. Hash ${active.hash.slice(0, 12)}…` : "Mostrando o padrão da vertical. A versão 1 é gravada na primeira pesquisa ou quando você salvar abaixo."}>
        <p className="mb-4 text-xs text-muted-foreground">O score tem 3 objetivos separados (valor comercial, viabilidade e descoberta). A prioridade geral só existe quando os três têm dado suficiente; senão é rotulada como parcial. Dimensão sem dado fica de fora da conta e é listada como “falta medir”.</p>
        <ScoreConfigForm key={active?.id ?? "default"} model={toFormModel(current)} />
      </Panel>
      <Panel title="Versões" description="Histórico imutável. Para ver o efeito de uma versão, abra uma oportunidade e use “Ajustar o score”.">
        {configs.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma versão gravada.</p> : (
          <table className="w-full text-xs"><caption className="sr-only">Versões da configuração</caption><thead className="font-mono text-[10.5px] text-muted-foreground uppercase"><tr><th scope="col" className="text-left font-normal">Versão</th><th scope="col" className="text-left font-normal">Criada em</th><th scope="col" className="text-left font-normal">Nota</th><th scope="col" className="text-left font-normal">Hash</th></tr></thead>
            <tbody>{configs.map((c) => (<tr key={c.id} className="border-t border-border"><td className="py-1.5 font-medium">v{c.version}</td><td>{formatDateTime(c.createdAt)}</td><td>{c.note ?? "—"}</td><td className="font-mono">{c.hash.slice(0, 12)}</td></tr>))}</tbody></table>
        )}
        <p className="mt-3 text-xs"><Link href="/opportunities" className="underline underline-offset-2">Voltar para as oportunidades</Link></p>
      </Panel>
    </div>
  );
}
