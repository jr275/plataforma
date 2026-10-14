"use client";

import { Badge } from "@/components/ui/badge";
import { DIMENSIONS, type ScoreResult, type Weights, type DimensionId } from "@/lib/intel/score";
import { cn } from "@/lib/utils";
import { DataStateBadge } from "./primitives";

/** Decomposição do score: cada dimensão com valor, peso, origem e motivo. Dimensões sem dado aparecem como lacunas. */
export function ScoreBreakdown({ result, weights, onWeight, compact = false }: { result: ScoreResult; weights: Weights; onWeight?: (id: DimensionId, w: number) => void; compact?: boolean }) {
  const groups = [
    { kind: "driver" as const, title: "Impulsionadores" },
    { kind: "risk" as const, title: "Riscos (reduzem o score)" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-3xl leading-none font-medium tabular-nums">{result.score}</p>
          <p className="mt-1.5 text-xs text-muted-foreground">Score ilustrativo · {result.version}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge tone={result.confidence === "alta" ? "success" : result.confidence === "média" ? "warning" : "danger"}>Confiança {result.confidence}</Badge>
          <span className="font-mono text-[11px] text-muted-foreground">{Math.round(result.coverage * 100)}% do peso com dado</span>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
        Ordena o trabalho; não prevê nem garante posição no Google ou citação em respostas de IA. {result.missing.length} dimensão(ões) sem dado não entram no cálculo.
      </p>
      {groups.map((g) => (
        <div key={g.kind}>
          <p className="mb-1.5 font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">{g.title}</p>
          <ul className="flex flex-col">
            {DIMENSIONS.filter((d) => d.kind === g.kind).map((d) => {
              const r = result.dimensions.find((x) => x.id === d.id)!;
              const v = r.value === null ? null : Math.round(r.value * 100);
              return (
                <li key={d.id} className="border-b border-border py-2 last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("min-w-0 flex-1 truncate text-[13px]", v === null && "text-muted-foreground")}>{d.label}</span>
                    <DataStateBadge state={r.state} />
                    <div className="h-1.5 w-16 bg-muted" aria-hidden="true">
                      {v !== null ? <div className={cn("h-full", d.kind === "risk" ? "bg-destructive" : "bg-brand")} style={{ width: `${v}%` }} /> : null}
                    </div>
                    <span className="w-8 text-right font-mono text-[11px] tabular-nums">{v ?? "—"}</span>
                  </div>
                  {!compact ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.reason}</p> : null}
                  {onWeight ? (
                    <label className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="w-10 font-mono">peso {weights[d.id]}</span>
                      <input
                        type="range"
                        min={0}
                        max={5}
                        step={1}
                        value={weights[d.id]}
                        onChange={(e) => onWeight(d.id, Number(e.target.value))}
                        aria-label={`Peso de ${d.label}`}
                        className="h-1 flex-1 accent-[var(--brand)]"
                      />
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
