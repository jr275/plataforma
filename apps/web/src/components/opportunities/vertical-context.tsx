/** Contexto da vertical ativa: toda tela do motor diz em qual vertical, idioma e país está operando (a plataforma é genérica; o imobiliário é só a primeira vertical). */
export function VerticalContext({ name, language, country }: { name: string; language: string; country: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 rounded-md border border-border px-2 py-0.5 font-mono text-[10.5px] tracking-wide text-muted-foreground" title="Vertical ativa deste workspace">
      <span className="uppercase">Vertical</span><span className="text-foreground">{name}</span><span aria-hidden="true">·</span>{language}<span aria-hidden="true">·</span>{country}
    </span>
  );
}
