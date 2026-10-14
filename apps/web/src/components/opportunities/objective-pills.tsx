/** Os três objetivos do score lado a lado: preenchido = calculado; vazio = sem dado (nunca zero). Cobertura diferente significa score não equivalente. */
const NAMES = [["C", "Valor comercial"], ["V", "Viabilidade"], ["D", "Descoberta"]] as const;
export function ObjectivePills({ values }: { values: readonly [number | null, number | null, number | null] }) {
  const label = NAMES.map(([, n], i) => `${n}: ${values[i] === null ? "não medido" : values[i]!.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}`).join("; ");
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex gap-1 font-mono text-[10.5px]">
      {NAMES.map(([k], i) => (
        <span key={k} className={`grid h-5 w-9 place-items-center rounded border tabular-nums ${values[i] === null ? "border-dashed border-border text-muted-foreground/60" : "border-border bg-muted/60 text-foreground"}`}>{values[i] === null ? k : `${k} ${Math.round(values[i]!)}`}</span>
      ))}
    </span>
  );
}
