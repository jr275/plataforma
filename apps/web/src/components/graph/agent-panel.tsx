"use client";

import { useActionState } from "react";
import { Loader2, Wrench } from "lucide-react";
import type { graph } from "@plataforma/api";
import { investigateAction, type InvestigateState } from "@/app/(app)/graph/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentThread } from "./agent-thread";

export interface AgentTool { id: graph.GraphTool; label: string }

/** Superfície de investigação CONTEXTUAL: o nó selecionado é o contexto; cada botão executa uma ferramenta REAL e somente leitura no servidor. Sem modelo de linguagem. */
export function AgentPanel({ nodeRef, nodeLabel, tools, unavailable }: { nodeRef: string; nodeLabel: string; tools: readonly AgentTool[]; /** Motivo pelo qual as ferramentas não podem rodar neste ambiente (ex.: prévia sem sessão). */ unavailable?: string }) {
  const [state, action, pending] = useActionState<InvestigateState, FormData>(investigateAction, { runs: [] });
  return (
    <section aria-label="Investigação contextual" className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="agent-panel">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-[0.08em] uppercase"><Wrench className="size-3.5" aria-hidden="true" />Investigar</h2>
        <Badge tone="success">Ferramentas reais</Badge>
        <Badge tone="outline">somente leitura</Badge>
      </header>
      <p className="text-xs text-muted-foreground">Contexto: <strong className="text-foreground">{nodeLabel}</strong>. Cada ferramenta consulta o banco do seu workspace e devolve achados com a fonte; nada é escrito.</p>
      <form action={action} className="flex flex-wrap gap-1.5" aria-label="Ferramentas disponíveis para esta entidade">
        <input type="hidden" name="node" value={nodeRef} />
        {tools.map((t) => (
          <Button key={t.id} type="submit" name="tool" value={t.id} variant="outline" size="sm" disabled={pending || unavailable !== undefined} aria-busy={pending}>
            {pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : null}{t.label}
          </Button>
        ))}
      </form>
      {unavailable ? <p role="note" className="rounded-lg border border-info/30 bg-info/10 px-2.5 py-1.5 text-xs">{unavailable}</p> : null}
      {state.error ? <p role="alert" className="text-xs text-destructive">{state.error}</p> : null}
      <AgentThread runs={state.runs} pending={pending} />
      <div className="space-y-1.5 border-t border-border pt-3">
        <label htmlFor="agent-free-text" className="sr-only">Pergunta em linguagem livre (indisponível)</label>
        <textarea id="agent-free-text" disabled rows={2} placeholder="Perguntas em linguagem livre exigem um agente conectado." className="w-full resize-none rounded-lg border border-input bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground" />
        <p className="text-[11px] leading-snug text-muted-foreground">Nenhum modelo de linguagem está conectado e o CopilotKit/AG-UI não estão instalados: não há respostas geradas nem execução autônoma. Os passos acima mostram o que foi realmente executado (sem streaming nesta versão).</p>
      </div>
    </section>
  );
}
