import type { GateResult } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { GATE_LABEL, GATE_OUTCOME } from "./format";

/** Os seis gates de uma tentativa, cada um com o próprio resultado e o motivo (nunca uma nota única). */
export function GatesPanel({ gates, title = "Gates de qualidade", description }: { gates: readonly GateResult[]; title?: string; description?: string }) {
  return (
    <Panel title={title} description={description ?? "Cada gate grava o próprio resultado. Um gate reprovado bloqueia a página."}>
      <ol className="divide-y divide-border">
        {gates.map((g) => (
          <li key={g.gate} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{GATE_LABEL[g.gate]}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{g.detail}</p>
            </div>
            <Badge tone={GATE_OUTCOME[g.outcome].tone} className="self-start">{GATE_OUTCOME[g.outcome].label}</Badge>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
