"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Ban, Check, ChevronRight, CircleAlert, Loader2, RotateCcw, ShieldCheck, Square, Trash2, Wrench } from "lucide-react";
import type { Claim, ClaimKind } from "@/lib/agent/ag-ui";
import type { AgentIntent } from "@/lib/agent/mock-graph-agent";
import type { GraphIndex } from "@/lib/graph/query";
import { cn } from "@/lib/utils";
import { evidenceFor } from "./graph-inspector";
import { GlyphIcon } from "./node-glyph";
import { Eyebrow, Pill, VerificationPill } from "./primitives";
import type { Decision, StepState, ToolCallState, Turn } from "./use-agent-run";

type Props = {
  turns: readonly Turn[];
  running: boolean;
  index: GraphIndex;
  contextLabel?: string;
  hasPath: boolean;
  onRun: (prompt: string, intent?: AgentIntent) => void;
  onCancel: () => void;
  onClear: () => void;
  onDecide: (turnId: string, decision: Decision) => void;
  onFocusClaim: (claim: Claim) => void;
  onSelectNode: (id: string) => void;
};

const CLAIM_META: Record<ClaimKind, { label: string; tone: "success" | "info" | "brand"; hint: string }> = {
  fact: { label: "Fato verificado", tone: "success", hint: "Sustentado por fato com fonte verificada." },
  inference: { label: "Inferência", tone: "info", hint: "Derivado do modelo ou de evidência ainda não revisada." },
  suggestion: { label: "Sugestão", tone: "brand", hint: "Ação recomendada. Nada é alterado sem aprovação." },
};

function StatusIcon({ status }: { status: StepState["status"] }) {
  if (status === "running") return <Loader2 className="size-3.5 animate-spin text-brand" aria-label="Em execução" />;
  if (status === "completed") return <Check className="size-3.5 text-success" aria-label="Concluído" />;
  if (status === "cancelled") return <Ban className="size-3.5 text-muted-foreground" aria-label="Cancelado" />;
  return <CircleAlert className="size-3.5 text-destructive" aria-label="Falhou" />;
}

function Execution({ steps, tools }: { steps: StepState[]; tools: ToolCallState[] }) {
  if (!steps.length && !tools.length) return null;
  return (
    <ol className="flex flex-col gap-0.5 rounded-md bg-muted/40 p-1.5 ring-1 ring-inset ring-border" aria-label="Execução">
      {steps.map((s, i) => (
        <li key={`s-${i}`} className="flex h-6 items-center gap-2 px-1.5 text-[12px] text-muted-foreground">
          <StatusIcon status={s.status} />
          {s.name}
        </li>
      ))}
      {tools.map((t) => (
        <li key={t.id}>
          <details className="group">
            <summary className="flex h-6 cursor-pointer list-none items-center gap-2 rounded px-1.5 text-[12px] hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <StatusIcon status={t.status} />
              <Wrench className="size-3 text-muted-foreground" aria-hidden="true" />
              <span className="font-mono text-[11px] text-foreground/90">{t.name}</span>
              <ChevronRight className="ml-auto size-3 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
            </summary>
            <div className="mx-1.5 mt-1 mb-1.5 flex flex-col gap-1 rounded bg-background/60 p-2 font-mono text-[10.5px] leading-relaxed break-all text-muted-foreground">
              <p><span className="text-foreground/70">args</span> {t.args || "—"}</p>
              <p><span className="text-foreground/70">result</span> {t.result ?? (t.status === "running" ? "aguardando…" : "—")}</p>
            </div>
          </details>
        </li>
      ))}
    </ol>
  );
}

function ClaimItem({ claim, index, onFocus, onSelectNode }: { claim: Claim; index: GraphIndex; onFocus: () => void; onSelectNode: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const meta = CLAIM_META[claim.kind];
  const evidence = evidenceFor(index, claim.evidenceIds);
  return (
    <li className="flex flex-col gap-1.5 rounded-md p-2 ring-1 ring-inset ring-border hover:ring-brand/40">
      <div className="flex items-start gap-2">
        <Pill tone={meta.tone} className="mt-0.5">{meta.label}</Pill>
        <button type="button" onClick={onFocus} title="Destacar no grafo" className="min-w-0 flex-1 text-left text-[13px] leading-relaxed text-pretty text-foreground/90 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {claim.text}
        </button>
      </div>
      {evidence.length ? (
        <div className="pl-1">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} aria-hidden="true" />
            {evidence.length} evidência{evidence.length > 1 ? "s" : ""}
          </button>
          {open ? (
            <ul className="mt-1.5 flex flex-col gap-1.5">
              {evidence.map(({ fact, source }) => (
                <li key={fact.id} className="rounded bg-muted/50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <button type="button" onClick={() => onSelectNode(fact.id)} className="truncate text-left text-[12px] font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{fact.label}</button>
                    <VerificationPill value={fact.verification} />
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{fact.summary}</p>
                  {source ? (
                    <button type="button" onClick={() => onSelectNode(source.id)} className="mt-1 flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                      <GlyphIcon kind="source" size={10} /> {source.label} · {source.freshness} · verificado {fact.verifiedAt}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function TurnView({ turn, index, onDecide, onFocusClaim, onSelectNode, onRetry }: { turn: Turn; index: GraphIndex; onDecide: Props["onDecide"]; onFocusClaim: Props["onFocusClaim"]; onSelectNode: Props["onSelectNode"]; onRetry: () => void }) {
  const kinds: ClaimKind[] = ["fact", "inference", "suggestion"];
  return (
    <article className="flex flex-col gap-3" aria-busy={turn.status === "running"}>
      <div className="flex flex-col items-end gap-1">
        <p className="max-w-[90%] rounded-lg rounded-br-sm bg-secondary px-3 py-2 text-[13px] leading-relaxed text-secondary-foreground">{turn.prompt}</p>
        {turn.contextLabel ? <span className="font-mono text-[10px] text-muted-foreground">contexto · {turn.contextLabel}</span> : null}
      </div>

      <Execution steps={turn.steps} tools={turn.toolCalls} />

      {turn.text ? (
        <p className="text-[13.5px] leading-relaxed text-pretty text-foreground/95">
          {turn.text}
          {turn.status === "running" && !turn.answer ? <span aria-hidden="true" className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-brand align-middle" /> : null}
        </p>
      ) : null}

      {turn.answer ? (
        <section className="flex flex-col gap-3 rounded-lg bg-card p-3 ring-1 ring-inset ring-border">
          <Eyebrow>{turn.answer.title}</Eyebrow>
          {kinds.map((k) => {
            const items = turn.answer!.claims.filter((c) => c.kind === k);
            if (!items.length) return null;
            return (
              <div key={k} className="flex flex-col gap-1.5">
                <p className="text-[11.5px] text-muted-foreground">{CLAIM_META[k].hint}</p>
                <ul className="flex flex-col gap-1.5">
                  {items.map((c) => <ClaimItem key={c.id} claim={c} index={index} onFocus={() => onFocusClaim(c)} onSelectNode={onSelectNode} />)}
                </ul>
              </div>
            );
          })}
          {turn.answer.rows.length ? (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1 font-mono text-[10.5px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" aria-hidden="true" /> Tabela de relações · {turn.answer.rows.length}
              </summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">
                    <tr><th className="py-1 pr-2 font-medium">Relação</th><th className="py-1 pr-2 font-medium">Nó</th><th className="py-1 pr-2 font-medium">Estado</th><th className="py-1 text-right font-medium">Evid.</th></tr>
                  </thead>
                  <tbody>
                    {turn.answer.rows.map((r) => {
                      const other = index.byId.get(r.otherId);
                      return (
                        <tr key={r.edgeId} className="border-t border-border/60">
                          <td className="py-1.5 pr-2 font-mono text-[11px] text-muted-foreground">{r.direction === "in" ? "← " : "→ "}{r.relation}</td>
                          <td className="py-1.5 pr-2">
                            {other ? <button type="button" onClick={() => onSelectNode(other.id)} className="text-foreground/90 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{other.label}</button> : r.otherId}
                          </td>
                          <td className="py-1.5 pr-2 text-muted-foreground">{r.verification}</td>
                          <td className="py-1.5 text-right font-mono tabular-nums">{r.evidenceCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </section>
      ) : null}

      {turn.proposal ? (
        <section className={cn("flex flex-col gap-2 rounded-lg p-3 ring-1 ring-inset", turn.proposal.decision === "pending" ? "bg-warning/8 ring-warning/40" : "bg-muted/40 ring-border")} aria-live="polite">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-warning" aria-hidden="true" />
            <Eyebrow className="text-warning">Requer aprovação humana</Eyebrow>
          </div>
          <p className="text-[13px] font-medium text-foreground">{turn.proposal.title}</p>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{turn.proposal.description}</p>
          {turn.proposal.decision === "pending" ? (
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => onDecide(turn.id, "approved")} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-[12.5px] font-medium text-brand-foreground hover:bg-brand/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                <Check className="size-3.5" aria-hidden="true" /> Aprovar nesta sessão
              </button>
              <button type="button" onClick={() => onDecide(turn.id, "rejected")} className="inline-flex h-8 items-center rounded-md px-3 text-[12.5px] text-muted-foreground ring-1 ring-inset ring-border hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                Rejeitar
              </button>
            </div>
          ) : turn.proposal.decision === "approved" ? (
            <p role="status" className="text-[12px] leading-relaxed text-success">Aprovado e aplicado apenas à visualização local desta sessão. Nada foi gravado: o protótipo não tem conexão de escrita com o backend.</p>
          ) : (
            <p role="status" className="text-[12px] text-muted-foreground">Rejeitado. Nenhuma alteração foi feita.</p>
          )}
        </section>
      ) : null}

      {turn.status === "cancelled" ? (
        <p role="status" className="flex items-center gap-2 text-[12px] text-muted-foreground"><Ban className="size-3.5" aria-hidden="true" /> Execução cancelada. Resultados parciais foram descartados.</p>
      ) : null}
      {turn.status === "failed" ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-destructive/10 p-3 ring-1 ring-inset ring-destructive/40">
          <p className="flex items-center gap-2 text-[12.5px] font-medium text-destructive"><CircleAlert className="size-4" aria-hidden="true" /> A execução falhou</p>
          <p className="text-[12.5px] leading-relaxed text-foreground/85">{turn.error}</p>
          <button type="button" onClick={onRetry} className="inline-flex h-7 w-fit items-center gap-1.5 rounded-md px-2 text-[12px] text-foreground ring-1 ring-inset ring-border hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <RotateCcw className="size-3.5" aria-hidden="true" /> Tentar novamente
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function AgentPanel(p: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = p.turns.at(-1);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [p.turns.length, last?.text, last?.answer, last?.proposal]);

  const submit = (text: string, intent?: AgentIntent) => {
    const t = text.trim();
    if (!t || p.running) return;
    p.onRun(t, intent);
    setDraft("");
  };

  const suggestions: { label: string; prompt: string; intent: AgentIntent; disabled?: boolean }[] = [
    { label: "Explicar relações", prompt: p.contextLabel ? `Explique as relações relevantes de ${p.contextLabel}.` : "Explique as relações relevantes da seleção.", intent: "explain" },
    { label: "Lacunas de evidência", prompt: p.contextLabel ? `Quais relações de ${p.contextLabel} não têm evidência verificada?` : "Quais lacunas de evidência existem?", intent: "gaps" },
    { label: "Explicar caminho", prompt: "Explique o caminho traçado entre as entidades.", intent: "path", disabled: !p.hasPath },
    { label: "Simular falha", prompt: "Simular falha do índice de evidências.", intent: "fail" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <span aria-hidden="true" className={cn("size-1.5 rounded-full", p.running ? "animate-pulse bg-brand" : "bg-muted-foreground/60")} />
        <h2 className="text-[13px] font-semibold text-foreground">Agente do grafo</h2>
        <Pill tone="warning">demo · determinístico</Pill>
        {p.turns.length ? (
          <button type="button" onClick={p.onClear} aria-label="Limpar conversa" className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <Trash2 className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
        {p.turns.length ? (
          <div className="flex flex-col gap-6">
            {p.turns.map((t) => (
              <TurnView key={t.id} turn={t} index={p.index} onDecide={p.onDecide} onFocusClaim={p.onFocusClaim} onSelectNode={p.onSelectNode} onRetry={() => submit(t.prompt)} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-2">
            <p className="text-[13.5px] leading-relaxed text-pretty text-foreground/90">
              Pergunte sobre o que está selecionado no grafo. As respostas separam <span className="text-success">fatos</span>, <span className="text-info">inferências</span> e <span className="text-brand">sugestões</span>, e destacam no grafo os nós envolvidos.
            </p>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Este agente é uma simulação local: percorre o grafo de demonstração e emite eventos no formato AG-UI. Não há modelo de linguagem nem integração CopilotKit conectada.
            </p>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="mb-2 flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              disabled={p.running || s.disabled}
              onClick={() => submit(s.prompt, s.intent)}
              className="h-6 rounded-full px-2.5 text-[11.5px] text-muted-foreground ring-1 ring-inset ring-border hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
            >
              {s.label}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); submit(draft); }} className="flex items-end gap-2 rounded-lg bg-muted/40 p-1.5 ring-1 ring-inset ring-border focus-within:ring-ring">
          <label htmlFor="agent-input" className="sr-only">Mensagem para o agente</label>
          <textarea
            id="agent-input"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                submit(draft);
              }
            }}
            placeholder={p.contextLabel ? `Perguntar sobre ${p.contextLabel}…` : "Selecione um nó e pergunte…"}
            className="max-h-28 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-[13.5px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {p.running ? (
            <button type="button" onClick={p.onCancel} aria-label="Cancelar execução" className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground text-background hover:bg-foreground/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <Square className="size-3 fill-current" aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim()} aria-label="Enviar" className="grid size-8 shrink-0 place-items-center rounded-md bg-brand text-brand-foreground hover:bg-brand/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40">
              <ArrowUp className="size-4" aria-hidden="true" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
