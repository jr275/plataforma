"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { STATUS_LABEL, type FlowNodeSpec, type NodeKind } from "@/lib/flow/model";

// Rótulo do tipo de etapa (caixa alta, fonte quadrada), como o nome do cliente no topo dos cards da referência.
const KIND_LABEL: Record<NodeKind, string> = {
  source: "Fonte", entity: "Entidade", knowledge: "Conhecimento", intel: "Inteligência de busca", recipe: "Receita", generate: "Produção",
  gate: "Quality Gate", judge: "Decisão", render: "Renderização", publish: "Publicação", observe: "Desempenho", learn: "Aprendizado", scope: "Escopo",
};

export type StageData = { spec: FlowNodeSpec; selected: boolean; dim: boolean };
export type StageNodeType = Node<StageData, "stage">;

/** Anel de contagem (não é uma nota): fração real de gates aprovados. */
function Ring({ value, label }: { value: number; label: string }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" role="img" aria-label={`${label} gates aprovados`} className="shrink-0">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--flow-line)" strokeWidth="5" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="butt" strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 28 28)" />
      <text x="28" y="32" textAnchor="middle" fontSize="12" fontWeight="600" fill="currentColor">{label}</text>
    </svg>
  );
}

function StageNodeImpl({ data }: NodeProps<StageNodeType>) {
  const { spec, selected, dim } = data;
  const ring = spec.kind === "judge" && spec.progress !== undefined && spec.metrics?.[0]?.label === "Gates ok";
  const body = spec.summary ?? spec.description;
  return (
    <div className="flow-node" data-status={spec.status} data-selected={selected} data-dim={dim}>
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="bt" type="target" position={Position.Bottom} style={{ left: "70%" }} />
      <Handle id="t" type="target" position={Position.Top} />
      <Handle id="tu" type="source" position={Position.Top} style={{ left: "70%" }} />
      <Handle id="ls" type="source" position={Position.Left} style={{ top: "70%" }} />
      <div className="flow-card">
        <div>
          <p className="flow-label text-[11px] leading-none" style={{ color: "var(--flow-muted)" }}>{KIND_LABEL[spec.kind]}</p>
          <p className="flow-label mt-2 flex items-center gap-2 text-[11px] leading-none font-medium" style={{ color: "var(--accent)" }}>
            <span className="flow-status-dot" aria-hidden="true" />
            {STATUS_LABEL[spec.status]}
          </p>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[21px] leading-[1.15] font-medium tracking-tight">{spec.title}</p>
            <p className="mt-2 line-clamp-3 text-[13.5px] leading-snug" style={{ color: spec.summary ? "var(--flow-text)" : "var(--flow-muted)" }} title={body}>{body}</p>
            {spec.progress !== undefined && !ring ? (
              <div className="mt-3 h-1.5 overflow-hidden" style={{ background: "var(--flow-line)" }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(spec.progress * 100)} aria-label="Itens registrados">
                <div className="h-full" style={{ width: `${Math.round(spec.progress * 100)}%`, background: "linear-gradient(90deg, var(--flow-cyan), var(--flow-blue))" }} />
              </div>
            ) : null}
            {spec.metrics && !ring ? (
              <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {spec.metrics.map((m) => (<div key={m.label} className="flex items-baseline gap-1.5"><dt className="flow-label text-[10px]" style={{ color: "var(--flow-muted)" }}>{m.label}</dt><dd className="text-[13px] font-semibold">{m.value}</dd></div>))}
              </dl>
            ) : null}
          </div>
          {ring ? <Ring value={spec.progress ?? 0} label={spec.metrics?.[0]?.value ?? ""} /> : null}
        </div>
      </div>
    </div>
  );
}

/** Mesmo conteúdo visível? Compara por valor (o servidor devolve objetos novos a cada atualização, com o mesmo conteúdo). */
function sameSpec(a: FlowNodeSpec, b: FlowNodeSpec): boolean {
  return a.id === b.id && a.status === b.status && a.title === b.title && a.summary === b.summary && a.progress === b.progress && JSON.stringify(a.metrics) === JSON.stringify(b.metrics);
}

// Memoizado: só reexecuta quando o estado DESTE nó muda (o grafo não é refeito a cada atualização).
export const StageNode = memo(StageNodeImpl, (a, b) => sameSpec(a.data.spec, b.data.spec) && a.data.selected === b.data.selected && a.data.dim === b.data.dim);
