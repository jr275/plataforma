import { CircleCheck, CircleX, Clock, FlaskConical, TriangleAlert } from "lucide-react";
import {
  demoGates,
  demoIndexHealth,
  demoOpportunities,
  demoQueue,
  demoTenants,
  type GateStatus,
  type Level,
} from "@/lib/demo-data";

const percent = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);

const gateLook: Record<GateStatus, { label: string; className: string; Icon: typeof CircleCheck }> = {
  pass: { label: "Passou", className: "text-emerald-700 dark:text-emerald-400", Icon: CircleCheck },
  fail: { label: "Falhou", className: "text-destructive", Icon: CircleX },
  pending: { label: "Pendente", className: "text-muted-foreground", Icon: Clock },
};

const levelClass: Record<Level, string> = {
  alta: "bg-foreground/10 text-foreground",
  média: "bg-foreground/5 text-foreground/80",
  baixa: "bg-transparent text-muted-foreground ring-1 ring-border",
};

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 text-card-foreground">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function Home() {
  const { canonical2xx, crawled, minimum } = demoIndexHealth;
  const ratio = canonical2xx / crawled;
  const blocked = ratio < minimum;

  return (
    <div className="flex flex-1 flex-col bg-muted/30">
      <div
        role="note"
        className="flex items-start gap-3 border-b border-border bg-foreground px-4 py-2.5 text-sm text-background sm:px-8"
      >
        <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          <strong className="font-semibold">Protótipo com dados fictícios.</strong> Nada nesta tela é medição, fato ou
          resultado do produto; nenhum dado vem do banco. Ambiente de teste, não indexável.
        </p>
      </div>

      <header className="border-b border-border bg-background px-4 py-5 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Plataforma · painel do tenant
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Loja Exemplo</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tenant fictício. Cada tenant só enxerga os próprios dados.
            </p>
          </div>
          <nav aria-label="Tenants fictícios (não funcional)" className="flex flex-wrap gap-2">
            {demoTenants.map((t) => (
              <span
                key={t.id}
                aria-current={t.active ? "true" : undefined}
                className={
                  t.active
                    ? "rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background"
                    : "rounded-full px-3 py-1 text-xs text-muted-foreground ring-1 ring-border"
                }
              >
                {t.name}
              </span>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 content-start gap-4 px-4 py-6 sm:px-8 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Card
            title="Saúde do índice"
            note="URLs 2xx canônicas ÷ URLs rastreadas. Mínimo de 95% antes da primeira onda."
          >
            <p className="text-4xl font-semibold tracking-tight tabular-nums">{percent(ratio)}</p>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {canonical2xx.toLocaleString("pt-BR")} de {crawled.toLocaleString("pt-BR")} URLs (valores fictícios)
            </p>
            <div
              className="relative mt-4 h-2 rounded-full bg-muted"
              role="img"
              aria-label={`Saúde do índice ${percent(ratio)}; mínimo ${percent(minimum)}`}
            >
              <div className="h-2 rounded-full bg-foreground/70" style={{ width: `${ratio * 100}%` }} />
              <div className="absolute -top-1 h-4 w-0.5 bg-foreground" style={{ left: `${minimum * 100}%` }} />
            </div>
            <p
              className={`mt-3 flex items-center gap-1.5 text-xs font-medium ${
                blocked ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"
              }`}
            >
              {blocked ? (
                <TriangleAlert className="size-3.5" aria-hidden="true" />
              ) : (
                <CircleCheck className="size-3.5" aria-hidden="true" />
              )}
              {blocked ? "Abaixo do mínimo: publicação bloqueada" : "Dentro do mínimo"}
            </p>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card title="Quality Gates" note="Cada gate grava o próprio resultado. Não existe nota composta.">
            <ul className="divide-y divide-border">
              {demoGates.map((g) => {
                const { label, className, Icon } = gateLook[g.status];
                return (
                  <li key={g.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                    <Icon className={`mt-0.5 size-4 shrink-0 ${className}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{g.name}</p>
                      <p className="text-xs text-muted-foreground">{g.detail}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-medium ${className}`}>{label}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card title="Oportunidades" note="Fatores separados, em níveis qualitativos. Não há nota única.">
            <div className="-mx-2 overflow-x-auto px-2">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <caption className="sr-only">Oportunidades fictícias por página-alvo</caption>
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="pb-2 pr-3 font-medium">Página-alvo</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Intenção</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Demanda</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Concorrência</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Evidência</th>
                    <th scope="col" className="pb-2 pr-3 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {demoOpportunities.map((o) => (
                    <tr key={o.page}>
                      <th scope="row" className="py-2.5 pr-3 font-mono text-xs font-normal">
                        {o.page}
                      </th>
                      <td className="py-2.5 pr-3 text-muted-foreground">{o.intent}</td>
                      {([o.demand, o.competition, o.evidence] as const).map((lvl, i) => (
                        <td key={i} className="py-2.5 pr-3">
                          <span className={`rounded-md px-2 py-0.5 text-xs ${levelClass[lvl]}`}>{lvl}</span>
                        </td>
                      ))}
                      <td className="py-2.5 text-muted-foreground">{o.state}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card title="Fila de publicação" note="Contagens fictícias por estado.">
            <dl className="space-y-2.5">
              {demoQueue.map((q) => (
                <div key={q.state} className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-muted-foreground">{q.state}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{q.count}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Nada é publicado indexável sem passar em todos os gates.
            </p>
          </Card>
        </div>
      </main>

      <footer className="border-t border-border bg-background px-4 py-4 text-xs text-muted-foreground sm:px-8">
        <div className="mx-auto max-w-6xl">
          Protótipo visual. Dados fictícios. Substituir por funções tipadas de packages/api.
        </div>
      </footer>
    </div>
  );
}
