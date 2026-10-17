import type { FactRow, PageBlock } from "@plataforma/api";

// Blocos do site publicado (ADR-040). Componentes PUROS: só exibem o que recebem, sem texto novo e sem HTML livre (todo texto passa pelo
// escape do React). A largura é por CONTÊINER (`@container` no SitePage), então o mesmo bloco reflui no quadro de celular da prévia.
const C = { fg: "text-[color:var(--site-fg)]", muted: "text-[color:var(--site-muted)]", accent: "text-[color:var(--site-accent)]", line: "border-[color:var(--site-line)]", surface: "bg-[color:var(--site-surface)]" } as const;

export type LinkMode = "preview" | "live";
type Of<T extends PageBlock["type"]> = Extract<PageBlock, { type: T }>;

export function BreadcrumbBlock({ block, linkMode }: { block: Of<"breadcrumb">; linkMode: LinkMode }) {
  return (
    <nav aria-label="Trilha de navegação" className="mb-4">
      <ol className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs ${C.muted}`}>
        {block.items.map((it, i) => {
          const last = i === block.items.length - 1;
          return (
            <li key={`${it.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 ? <span aria-hidden="true">/</span> : null}
              {it.path && linkMode === "live" ? <a href={it.path} className={`${C.accent} underline underline-offset-2`}>{it.label}</a> : <span aria-current={last ? "page" : undefined} className={last ? C.fg : undefined}>{it.label}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function HeroBlock({ block }: { block: Of<"hero"> }) {
  return (
    <header className="mb-8">
      <h1 className={`text-[1.75rem] leading-[1.15] font-semibold tracking-tight text-balance @xl:text-5xl ${C.fg}`}>{block.h1}</h1>
      {block.lead ? <p className={`mt-4 text-base leading-relaxed @xl:text-xl ${C.muted}`}>{block.lead}</p> : null}
    </header>
  );
}

export function ProseBlock({ block }: { block: Of<"prose"> }) {
  const id = `site-${block.id}`;
  return (
    <section aria-labelledby={id} className="mb-8">
      <h2 id={id} className={`text-xl font-semibold tracking-tight @xl:text-2xl ${C.fg}`}>{block.heading}</h2>
      {block.paragraphs.map((p, i) => (<p key={i} className={`mt-3 text-[15px] leading-relaxed @xl:text-base ${C.fg}`}>{p}</p>))}
    </section>
  );
}

function Reference({ row }: { row: FactRow }) {
  return row.asOf === null ? <span aria-label="sem ano de referência">—</span> : <>{`ref. ${row.asOf}`}</>;
}

export function FactsBlock({ block }: { block: Of<"facts"> }) {
  return (
    <section aria-labelledby="site-facts" className="mb-8">
      <h2 id="site-facts" className={`text-xl font-semibold tracking-tight @xl:text-2xl ${C.fg}`}>{block.heading}</h2>
      <div className={`mt-3 overflow-hidden rounded-lg border ${C.line}`}>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{block.heading}</caption>
          <thead className={`${C.surface} ${C.muted}`}>
            <tr><th scope="col" className="px-3 py-2 font-medium @xl:px-4">Dado</th><th scope="col" className="px-3 py-2 font-medium @xl:px-4">Valor</th><th scope="col" className="px-3 py-2 font-medium @xl:px-4">Referência</th></tr>
          </thead>
          <tbody>
            {block.rows.map((r) => (
              <tr key={r.factId} data-fact-id={r.factId} className={`border-t ${C.line}`}>
                <th scope="row" className={`px-3 py-2.5 font-normal @xl:px-4 ${C.muted}`}>{r.label}</th>
                <td className={`px-3 py-2.5 font-medium tabular-nums @xl:px-4 ${C.fg}`}>{r.value}</td>
                <td className={`px-3 py-2.5 text-xs @xl:px-4 ${C.muted}`}><Reference row={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function LinksBlock({ block, linkMode }: { block: Of<"links">; linkMode: LinkMode }) {
  return (
    <nav aria-label={block.heading} className={`mb-8 border-t pt-5 ${C.line}`}>
      <h2 className={`text-sm font-semibold ${C.fg}`}>{block.heading}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {block.items.map((l) => (
          <li key={l.path}>
            {linkMode === "live"
              ? <a href={l.path} className={`inline-flex rounded-full border px-3 py-1 text-sm underline-offset-2 hover:underline ${C.line} ${C.accent}`}>{l.text}</a>
              : <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${C.line} ${C.accent}`}>{l.text}<span className={`font-mono text-[11px] ${C.muted}`}>{l.path}</span></span>}
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SourcesBlock({ block }: { block: Of<"sources"> }) {
  return (
    <footer className={`border-t pt-5 ${C.line}`}>
      <h2 className={`text-sm font-semibold ${C.fg}`}>{block.heading}</h2>
      <ul className={`mt-3 space-y-1.5 text-xs leading-relaxed ${C.muted}`}>{block.items.map((s, i) => (<li key={i}>{s}</li>))}</ul>
    </footer>
  );
}

/** Despacho EXAUSTIVO: um tipo novo no catálogo sem componente aqui deixa de compilar. */
export function renderBlock(block: PageBlock, key: number, linkMode: LinkMode) {
  switch (block.type) {
    case "breadcrumb": return <BreadcrumbBlock key={key} block={block} linkMode={linkMode} />;
    case "hero": return <HeroBlock key={key} block={block} />;
    case "prose": return <ProseBlock key={key} block={block} />;
    case "facts": return <FactsBlock key={key} block={block} />;
    case "links": return <LinksBlock key={key} block={block} linkMode={linkMode} />;
    case "sources": return <SourcesBlock key={key} block={block} />;
    default: { const never: never = block; throw new Error(`bloco sem componente: ${JSON.stringify(never)}`); }
  }
}
