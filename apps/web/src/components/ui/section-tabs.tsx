/** Barra de seções da página no estilo de abas (células com borda, rótulo em maiúsculas); são âncoras: navegar não troca de rota nem esconde conteúdo. */
export function SectionTabs({ label, items }: { label: string; items: readonly (readonly [string, string])[] }) {
  return (
    <nav aria-label={label} className="flex overflow-x-auto border border-border bg-card">
      {items.map(([id, l]) => (
        <a key={id} href={`#${id}`} className="h-10 min-w-max flex-1 shrink-0 border-r border-border px-4 text-center font-mono text-[11px] font-medium leading-10 tracking-[0.08em] text-muted-foreground uppercase transition-colors last:border-r-0 hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground focus-visible:outline-none">{l}</a>
      ))}
    </nav>
  );
}
