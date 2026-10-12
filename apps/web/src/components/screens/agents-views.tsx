"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dl } from "@/components/ui/field";
import { NotFoundState } from "@/components/ui/not-found-state";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { ResourceList } from "@/components/ui/resource-list";

export function AgentsList() {
  const { current, agentRuns } = useAppState();
  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Agents" }]} title="Agentes" description={`Quem executa o trabalho em ${current.workspace.name}, com escopo e ferramentas explícitos. As execuções aqui são simuladas.`} badges={<Badge tone="warning">Execuções simuladas</Badge>} />
      <ResourceList
        rows={current.agents.map((a) => {
          const runs = agentRuns(current.workspace.id, a.id);
          return { id: a.id, href: `/agents/${a.id}`, title: a.name, subtitle: a.description, badges: <Badge tone="outline">{a.role}</Badge>, meta: runs[0] ? `rodou ${runs[0].when}` : `última: ${a.lastRun}` };
        })}
        empty={null}
        count={`${current.agents.length} agentes`}
      />
    </div>
  );
}

export function AgentDetail({ id }: { id: string }) {
  const { current, agentRuns, addAgentRun, notify } = useAppState();
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const agent = current.agents.find((a) => a.id === id);
  if (!agent) return <NotFoundState what="Agente" backHref="/agents" backLabel="Voltar para Agents" />;
  const runs = agentRuns(current.workspace.id, agent.id);
  const run = () => {
    setRunning(true);
    timer.current = setTimeout(() => {
      addAgentRun(current.workspace.id, agent.id, { id: `run-${Date.now()}`, when: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), output: agent.simulatedOutput });
      setRunning(false);
      notify(`${agent.name}: execução simulada concluída. Nada real foi executado.`);
    }, 900);
  };
  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Agents", href: "/agents" }, { label: agent.name }]}
        title={agent.name}
        description={agent.description}
        badges={<Badge tone="outline">{agent.role}</Badge>}
        actions={<Button size="lg" onClick={run} disabled={running}><Play data-icon="inline-start" aria-hidden="true" />{running ? "Executando (simulado)…" : "Executar (simulado)"}</Button>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Execuções simuladas" description="Resultados fixos de demonstração; não há agente real por trás." className="lg:col-span-2">
          {runs.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma execução neste navegador. Use “Executar (simulado)”.</p> : (
            <ol className="space-y-3">{runs.map((r) => (<li key={r.id} className="rounded-lg border border-border p-3 text-sm"><p className="text-xs text-muted-foreground">{r.when} · simulada</p><p className="mt-1">{r.output}</p></li>))}</ol>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Escopo"><p className="text-sm">{agent.scope}</p></Panel>
          <Panel title="Ferramentas"><ul className="flex flex-wrap gap-1.5">{agent.tools.map((t) => (<li key={t}><Badge tone="outline">{t}</Badge></li>))}</ul></Panel>
          <Panel title="Histórico"><Dl items={[{ label: "Última execução (fixture)", value: agent.lastRun }, { label: "Execuções simuladas", value: String(runs.length) }]} /></Panel>
        </div>
      </div>
    </div>
  );
}
