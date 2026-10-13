"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgUiEvent, ChangeProposal, GraphAnswer } from "@/lib/agent/ag-ui";
import { isAbort, runMockGraphAgent, type AgentInput } from "@/lib/agent/mock-graph-agent";

export type RunStatus = "running" | "completed" | "cancelled" | "failed";
export type ToolCallState = { id: string; name: string; args: string; status: "running" | "completed" | "failed" | "cancelled"; result?: string };
export type StepState = { name: string; status: "running" | "completed" | "failed" | "cancelled" };
export type Decision = "pending" | "approved" | "rejected";

export type Turn = {
  id: string;
  prompt: string;
  contextLabel?: string;
  status: RunStatus;
  steps: StepState[];
  toolCalls: ToolCallState[];
  text: string;
  answer?: GraphAnswer;
  proposal?: ChangeProposal & { decision: Decision };
  error?: string;
};

const settle = (status: RunStatus) => <T extends { status: string }>(x: T): T => (x.status === "running" ? { ...x, status: status === "completed" ? "completed" : status } : x);

function apply(turn: Turn, ev: AgUiEvent): Turn {
  switch (ev.type) {
    case "STEP_STARTED":
      return { ...turn, steps: [...turn.steps, { name: ev.stepName, status: "running" }] };
    case "STEP_FINISHED":
      return { ...turn, steps: turn.steps.map((s) => (s.name === ev.stepName ? { ...s, status: "completed" } : s)) };
    case "TOOL_CALL_START":
      return { ...turn, toolCalls: [...turn.toolCalls, { id: ev.toolCallId, name: ev.toolCallName, args: "", status: "running" }] };
    case "TOOL_CALL_ARGS":
      return { ...turn, toolCalls: turn.toolCalls.map((t) => (t.id === ev.toolCallId ? { ...t, args: t.args + ev.delta } : t)) };
    case "TOOL_CALL_RESULT":
      return { ...turn, toolCalls: turn.toolCalls.map((t) => (t.id === ev.toolCallId ? { ...t, status: "completed", result: ev.content } : t)) };
    case "TEXT_MESSAGE_CONTENT":
      return { ...turn, text: turn.text + ev.delta };
    case "CUSTOM":
      if (ev.name === "graph.answer") return { ...turn, answer: ev.value };
      if (ev.name === "approval.request") return { ...turn, proposal: { ...ev.value, decision: "pending" } };
      return turn;
    case "RUN_ERROR":
      return { ...turn, status: "failed", error: ev.message, steps: turn.steps.map(settle("failed")), toolCalls: turn.toolCalls.map(settle("failed")) };
    case "RUN_FINISHED":
      return { ...turn, status: "completed", steps: turn.steps.map(settle("completed")), toolCalls: turn.toolCalls.map(settle("completed")) };
    default:
      return turn;
  }
}

/**
 * Consome um fluxo de eventos AG-UI e o transforma em estado de interface.
 * Hoje a fonte é o agente demonstrativo; para integrar um agente real, troque `runMockGraphAgent`
 * por um iterável de eventos vindo de `@ag-ui/client` (HttpAgent) ou do runtime do CopilotKit.
 */
export function useAgentRun(onHighlight: (h: { nodeIds: string[]; edgeIds: string[] }) => void) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const controller = useRef<AbortController | null>(null);
  const highlightRef = useRef(onHighlight);
  useEffect(() => {
    highlightRef.current = onHighlight;
  }, [onHighlight]);

  const update = useCallback((id: string, fn: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.id === id ? fn(t) : t))), []);

  const run = useCallback(
    async (input: AgentInput, contextLabel?: string) => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      const id = `turn-${Date.now().toString(36)}`;
      setTurns((all) => [...all, { id, prompt: input.prompt, contextLabel, status: "running", steps: [], toolCalls: [], text: "" }]);
      try {
        for await (const ev of runMockGraphAgent(input, ac.signal)) {
          if (ev.type === "CUSTOM" && ev.name === "graph.highlight") highlightRef.current(ev.value);
          update(id, (t) => apply(t, ev));
        }
      } catch (e) {
        if (isAbort(e)) {
          update(id, (t) => ({ ...t, status: "cancelled", steps: t.steps.map(settle("cancelled")), toolCalls: t.toolCalls.map(settle("cancelled")) }));
        } else {
          update(id, (t) => ({ ...t, status: "failed", error: e instanceof Error ? e.message : "Falha inesperada." }));
        }
      }
    },
    [update],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);
  const decide = useCallback((turnId: string, decision: Decision) => update(turnId, (t) => (t.proposal ? { ...t, proposal: { ...t.proposal, decision } } : t)), [update]);
  const clear = useCallback(() => { controller.current?.abort(); setTurns([]); }, []);

  return { turns, running: turns.some((t) => t.status === "running"), run, cancel, decide, clear };
}
