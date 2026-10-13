import type { RenderedPage } from "@plataforma/api";

/**
 * A página como o visitante a verá: h1, seções, links e a seção de fontes. Renderiza SOMENTE o que o motor produziu (nenhum texto é
 * acrescentado aqui). Usa cores próprias (claras) para simular o site, independentemente do tema da interface.
 */
export function RenderedArticle({ page }: { page: RenderedPage }) {
  const main = page.sections.filter((s) => s.id !== "sources");
  const sources = page.sections.find((s) => s.id === "sources");
  return (
    <article className="bg-white px-6 py-8 text-neutral-900 sm:px-10" data-testid="rendered-article">
      <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance">{page.h1}</h1>
      <div className="mt-6 space-y-7">
        {main.map((s) => (
          <section key={s.id} aria-labelledby={`sec-${s.id}`}>
            <h2 id={`sec-${s.id}`} className="text-xl font-semibold tracking-tight">{s.heading}</h2>
            {s.paragraphs.map((p, i) => (
              <p key={i} className="mt-2 text-[15px] leading-relaxed text-neutral-700">{p}</p>
            ))}
          </section>
        ))}
      </div>
      {page.links.length > 0 ? (
        <nav aria-label="Veja também" className="mt-8 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold">Veja também</h2>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {page.links.map((l) => (<li key={l.path}><span className="text-blue-700 underline underline-offset-2">{l.text}</span> <span className="text-neutral-400">{l.path}</span></li>))}
          </ul>
        </nav>
      ) : null}
      {sources ? (
        <footer className="mt-8 border-t border-neutral-200 pt-4">
          <h2 className="text-sm font-semibold">{sources.heading}</h2>
          <ul className="mt-2 space-y-1 text-xs text-neutral-500">
            {sources.paragraphs.map((p, i) => (<li key={i}>{p}</li>))}
          </ul>
        </footer>
      ) : null}
    </article>
  );
}
