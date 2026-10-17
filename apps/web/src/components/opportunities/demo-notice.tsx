/** Aviso fixo quando a tela cai na demonstração: o ambiente não tem login ou banco configurados. Nunca aparece com dado real. */
export function DemoFallbackNotice({ missing }: { missing: string }) {
  return (
    <p role="note" className="border border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
      <strong className="font-semibold text-foreground">Dados de demonstração.</strong> Este ambiente não tem {missing} configurado, então a tela mostra o workspace de exemplo. Com o ambiente configurado, ela passa a ler as oportunidades reais do seu workspace.
    </p>
  );
}
