import { brand } from "@/config/brand";

/** Marca provisória: trocar aqui não afeta o resto. */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center bg-primary font-mono text-[12px] font-semibold text-primary-foreground"
      >
        S
      </span>
      {compact ? null : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[13px] font-semibold tracking-tight">{brand.name}</span>
          <span className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">Protótipo · dados fictícios</span>
        </span>
      )}
    </div>
  );
}
