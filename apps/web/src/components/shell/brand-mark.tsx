import { brand } from "@/config/brand";

/** Marca provisória: trocar aqui não afeta o resto. */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-md bg-brand/15 font-mono text-[11px] font-semibold tracking-tight text-brand ring-1 ring-inset ring-brand/30"
      >
        S
      </span>
      {compact ? null : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold tracking-tight">{brand.name}</span>
          <span className="text-[11px] text-muted-foreground">Protótipo com dados fictícios</span>
        </span>
      )}
    </div>
  );
}
