import type { ReactNode } from "react";
import type { GscExportRow, GscExportSnapshot, GscLongRow } from "@plataforma/api";
import { DailyCharts } from "./daily-charts";
import { DataStateBadge } from "@/components/intel/primitives";
import { labelClass } from "@/components/ui/frame";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import type { GscExportLoaded } from "@/lib/server/gsc-export";

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const dec = (n: number, d = 1) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number, d = 1) => `${dec(n, d)}%`;
const date = (iso: string) => iso.split("-").reverse().join("/");

/** Variação contra o período anterior. Sem período anterior (zero), não existe porcentagem: o texto diz "novo". */
function Delta({ now, before, lowerIsBetter = false, unit = "%" }: { now: number; before: number; lowerIsBetter?: boolean; unit?: "%" | "pos" | "pp" }) {
  if (before === 0) return <span className="text-xs text-muted-foreground">{now === 0 ? "sem variação" : "sem período anterior para comparar"}</span>;
  const change = unit === "%" ? ((now - before) / before) * 100 : now - before;
  const better = lowerIsBetter ? change < 0 : change > 0;
  const flat = Math.abs(change) < 0.05;
  const sign = change > 0 ? "+" : "";
  const text = unit === "pos" ? `${sign}${dec(change, 2)} posições` : unit === "pp" ? `${sign}${dec(change, 2)} p.p.` : `${sign}${dec(change, 1)}%`;
  return (
    <span className={`font-mono text-xs ${flat ? "text-muted-foreground" : better ? "text-success" : "text-destructive"}`}>
      {text}<span className="text-muted-foreground"> vs 6 meses anteriores</span>
    </span>
  );
}

function Kpi({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <div className="card-cut flex flex-col gap-2 p-5">
      <p className={`${labelClass} text-[10px] text-muted-foreground`}>{label}</p>
      <p className="text-4xl font-medium tracking-[-0.02em] tabular-nums">{value}</p>
      {children}
    </div>
  );
}

function Share({ part, whole }: { part: number; whole: number }) {
  const w = whole > 0 ? Math.max(0, Math.min(100, (part / whole) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 bg-muted" role="meter" aria-label="Participação nos cliques" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w)}><div className="h-full bg-brand" style={{ width: `${w}%` }} /></div>
      <span className="w-12 text-right font-mono text-[11px] tabular-nums">{pct(w)}</span>
    </div>
  );
}

const DEVICE: Record<string, string> = { Mobile: "Celular", Desktop: "Computador", Tablet: "Tablet" };
const APPEARANCE: Record<string, string> = { "Product snippets": "Resultados de produto", "Discussion forums": "Fóruns de discussão", "Merchant listings": "Listagens de comerciante", "AMP non-rich results": "AMP (sem destaque)", "Web Story": "Web Stories", "AMP article": "Artigos AMP" };

function MetricTable({ rows, total, names, firstColumn }: { rows: readonly GscExportRow[]; total: number; names?: Record<string, string>; firstColumn: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className={`${labelClass} border-b border-border text-left text-[10px] text-muted-foreground`}>
            <th scope="col" className="py-2 pr-3 font-medium">{firstColumn}</th><th scope="col" className="py-2 pr-3 text-right font-medium">Cliques</th><th scope="col" className="py-2 pr-3 font-medium">Participação</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Impressões</th><th scope="col" className="py-2 pr-3 text-right font-medium">CTR</th><th scope="col" className="py-2 text-right font-medium">Posição</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/60 last:border-0">
              <th scope="row" className="py-2.5 pr-3 text-left font-normal">{names?.[r.key] ?? r.key}</th>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{int.format(r.clicks)}</td>
              <td className="py-2.5 pr-3"><Share part={r.clicks} whole={total} /></td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{int.format(r.impressions)}</td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{pct(r.ctr, 2)}</td>
              <td className="py-2.5 text-right font-mono tabular-nums">{dec(r.position, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Base dos endereços principais da propriedade: o prefixo de URL, ou o "www" do domínio quando a propriedade é de domínio (sc-domain:). */
function baseUrl(property: string): string {
  return property.startsWith("sc-domain:") ? `https://www.${property.slice("sc-domain:".length)}` : property.replace(/\/$/, "");
}

/** Mostra o caminho quando a URL é da base da propriedade; fora dela (por exemplo http em vez de https, ou outro host) mostra a URL inteira para o desvio ficar visível. */
function shortUrl(url: string, property: string): string {
  const base = baseUrl(property);
  return url.startsWith(base) ? url.slice(base.length) || "/" : url;
}

function RankTable({ rows, firstColumn, name, total }: { rows: readonly (GscLongRow & { prevClicks?: number })[]; firstColumn: string; name: (key: string) => string; total: number }) {
  const compare = rows.length > 0 && rows.every((r) => r.prevClicks !== undefined);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className={`${labelClass} border-b border-border text-left text-[10px] text-muted-foreground`}>
            <th scope="col" className="w-10 py-2 pr-2 font-medium">#</th><th scope="col" className="py-2 pr-3 font-medium">{firstColumn}</th><th scope="col" className="py-2 pr-3 text-right font-medium">Cliques</th>
            <th scope="col" className="py-2 pr-3 font-medium">Participação</th>{compare ? <th scope="col" className="py-2 pr-3 text-right font-medium">Vs anterior</th> : null}
            <th scope="col" className="py-2 pr-3 text-right font-medium">Impressões</th><th scope="col" className="py-2 pr-3 text-right font-medium">CTR</th><th scope="col" className="py-2 text-right font-medium">Posição</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className="border-b border-border/60 last:border-0">
              <td className="py-2.5 pr-2 font-mono text-[11px] text-muted-foreground tabular-nums">{i + 1}</td>
              <th scope="row" className="max-w-[26rem] truncate py-2.5 pr-3 text-left font-normal" title={r.key}>{name(r.key)}</th>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{int.format(r.clicks)}</td>
              <td className="py-2.5 pr-3"><Share part={r.clicks} whole={total} /></td>
              {compare ? <td className="py-2.5 pr-3 text-right"><RowDelta now={r.clicks} before={r.prevClicks ?? 0} /></td> : null}
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{int.format(r.impressions)}</td>
              <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{pct(r.ctr, 2)}</td>
              <td className="py-2.5 text-right font-mono tabular-nums">{dec(r.position, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Variação curta por linha: sem período anterior vira "novo" (não existe porcentagem sobre zero). */
function RowDelta({ now, before }: { now: number; before: number }) {
  if (before === 0) return <span className="font-mono text-xs text-muted-foreground">{now === 0 ? "—" : "novo"}</span>;
  const c = ((now - before) / before) * 100;
  return <span className={`font-mono text-xs tabular-nums ${Math.abs(c) < 0.05 ? "text-muted-foreground" : c > 0 ? "text-success" : "text-destructive"}`}>{c > 0 ? "+" : ""}{dec(c, 1)}%</span>;
}

/** O Search Console corta cada lista do export em 1.000 linhas: com exatamente esse número, a lista pode estar incompleta. */
const EXPORT_CAP = 1000;
const capNote = (rows: number) => (rows >= EXPORT_CAP ? ` O export para em ${int.format(EXPORT_CAP)} linhas (limite do Search Console): pode haver mais.` : "");
const periodLabel = (p: string) => (p === "Last 16 months" ? "Últimos 16 meses" : p === "Last 6 months" ? "Últimos 6 meses" : p);

const HEADER = (extra?: ReactNode) => (
  <PageHeader crumbs={[{ label: "Performance" }, { label: "Search Console" }]} title="Search Console: desempenho" description="Desempenho orgânico real do site, lido de um export do Search Console." badges={extra} />
);

const BLOCKED: Record<Exclude<GscExportLoaded["state"], "ready">, { title: string; hint: string }> = {
  not_loaded: { title: "Nenhum export carregado neste ambiente", hint: "Os números do Search Console ainda não foram carregados aqui. Nenhum dado de demonstração aparece no lugar. A carga permanente no banco depende da aprovação do ADR-016." },
  invalid: { title: "O arquivo do export não é válido", hint: "O arquivo existe, mas não tem o formato esperado (versão 1). Gere-o de novo com scripts/gsc-export-build.mjs." },
  other_tenant: { title: "Este export pertence a outro workspace", hint: "Por isolamento entre workspaces, o relatório só aparece para o workspace a que o export foi associado." },
  denied: { title: "Acesso negado", hint: "O relatório exige uma sessão verificada com workspace." },
};

export function SearchExportView({ loaded }: { loaded: GscExportLoaded }) {
  if (loaded.state !== "ready") {
    const c = BLOCKED[loaded.state];
    return <div className="flex flex-col gap-6">{HEADER()}<Panel title="Estado"><EmptyState title={c.title} hint={c.hint} /></Panel></div>;
  }
  const s: GscExportSnapshot = loaded.snapshot;
  const { current: now, previous: before } = s;
  return (
    <div className="flex flex-col gap-6">
      {HEADER(<><DataStateBadge state="imported" /><span className="text-xs text-muted-foreground">Export de {date(s.exportedAt)} · {s.searchType} · {s.period === "Last 6 months" ? "últimos 6 meses" : s.period}</span></>)}
      <p className="card-cut p-4 text-sm" role="note" data-testid="origin-note">
        Isto <strong>não é uma conexão ao vivo</strong>. São números reais do Search Console de <span className="font-mono">{s.property}</span>, carregados de um export em {date(s.exportedAt)}. Para atualizar, é preciso um novo export.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Cliques" value={int.format(now.clicks)}><Delta now={now.clicks} before={before.clicks} /></Kpi>
        <Kpi label="Impressões" value={int.format(now.impressions)}><Delta now={now.impressions} before={before.impressions} /></Kpi>
        <Kpi label="CTR" value={pct(now.ctr, 2)}><Delta now={now.ctr} before={before.ctr} unit="pp" /></Kpi>
        <Kpi label="Posição média" value={dec(now.position, 2)}><Delta now={now.position} before={before.position} lowerIsBetter unit="pos" /></Kpi>
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">A variação do CTR é em pontos percentuais. A posição média é ponderada por impressões; posição menor é melhor.</p>

      {s.daily ? (
        <Panel title="Evolução diária" description={`Série de ${s.daily.property}.${s.daily.property !== s.property ? " É outra propriedade que a das demais seções: os números não são comparáveis entre elas." : ""}`}>
          <DailyCharts points={s.daily.points} />
        </Panel>
      ) : null}

      <Panel title="Dispositivos" description="Cobrem 100% do tráfego: os totais acima saem desta tabela.">
        <MetricTable rows={s.devices} total={now.clicks} names={DEVICE} firstColumn="Dispositivo" />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Tipos de resultado" description="Só os que tiveram impressões no período.">
          {s.appearances.length === 0 ? <EmptyState title="Nenhum tipo de resultado com impressões" /> : <MetricTable rows={s.appearances} total={now.clicks} names={APPEARANCE} firstColumn="Tipo" />}
        </Panel>
        <Panel title="Países" description={`Os ${s.countries.length} maiores por cliques.`}>
          <MetricTable rows={s.countries} total={now.clicks} firstColumn="País" />
        </Panel>
      </div>

      {s.top ? (
        <>
          <Panel title="Páginas com mais cliques" description={`As ${s.top.pages.length} maiores de ${int.format(s.coverage.pages.rows)} páginas exportadas, juntas ${pct(s.coverage.pages.clicksShare)} dos cliques do site. URLs que não começam por ${baseUrl(s.property)} aparecem inteiras.`}>
            <RankTable rows={s.top.pages} firstColumn="Página" name={(k) => shortUrl(k, s.property)} total={now.clicks} />
          </Panel>
          <Panel title="Consultas com mais cliques" description={`As ${s.top.queries.length} maiores de ${int.format(s.coverage.queries.rows)} consultas exportadas, que juntas cobrem só ${pct(s.coverage.queries.clicksShare)} dos cliques do site. O resto é cauda anônima que o Google não entrega.`}>
            <RankTable rows={s.top.queries} firstColumn="Consulta" name={(k) => k} total={now.clicks} />
          </Panel>
        </>
      ) : null}

      <Panel title="Cobertura das listas exportadas" description="O Google omite a cauda de consultas anônimas e corta o export. Nenhum ranking abaixo deve ser lido como o total do site.">
        <dl className="grid gap-6 sm:grid-cols-3">
          <div><dt className={`${labelClass} text-[10px] text-muted-foreground`}>Consultas exportadas</dt><dd className="mt-1 text-2xl font-medium tabular-nums">{int.format(s.coverage.queries.rows)}</dd><dd className="mt-1 text-xs text-muted-foreground">{pct(s.coverage.queries.clicksShare)} dos cliques e {pct(s.coverage.queries.impressionsShare)} das impressões do total.</dd></div>
          <div><dt className={`${labelClass} text-[10px] text-muted-foreground`}>Páginas exportadas</dt><dd className="mt-1 text-2xl font-medium tabular-nums">{int.format(s.coverage.pages.rows)}</dd><dd className="mt-1 text-xs text-muted-foreground">{pct(s.coverage.pages.clicksShare)} dos cliques do total.</dd></div>
          <div><dt className={`${labelClass} text-[10px] text-muted-foreground`}>Como ler</dt><dd className="mt-1 text-xs text-muted-foreground">O resto é cauda longa que o Search Console não entrega por consulta. Por isso a lista de consultas não substitui o universo de busca completo.</dd></div>
        </dl>
      </Panel>

      {s.long ? (
        <>
          <Panel title="Páginas com mais cliques em 16 meses" description={`${periodLabel(s.long.period)}: ${int.format(s.long.total.clicks)} cliques, ${int.format(s.long.total.impressions)} impressões, CTR ${pct(s.long.total.ctr, 2)}, posição ${dec(s.long.total.position, 2)}. As ${s.long.topPages.length} maiores de ${int.format(s.long.coverage.pages.rows)} páginas exportadas, juntas ${pct(s.long.coverage.pages.clicksShare)} dos cliques.${capNote(s.long.coverage.pages.rows)} Este export não traz o período anterior, então não há variação.`}>
            <RankTable rows={s.long.topPages} firstColumn="Página" name={(k) => shortUrl(k, s.property)} total={s.long.total.clicks} />
          </Panel>
          <Panel title="Consultas com mais cliques em 16 meses" description={`As ${s.long.topQueries.length} maiores de ${int.format(s.long.coverage.queries.rows)} consultas exportadas, que juntas cobrem ${pct(s.long.coverage.queries.clicksShare)} dos cliques e ${pct(s.long.coverage.queries.impressionsShare)} das impressões do período. O resto é cauda anônima que o Google não entrega.${capNote(s.long.coverage.queries.rows)}`}>
            <RankTable rows={s.long.topQueries} firstColumn="Consulta" name={(k) => k} total={s.long.total.clicks} />
          </Panel>
        </>
      ) : null}

      {s.ai ? (
        <Panel title="Recursos de IA generativa" description="Só impressões: o export não traz cliques separados por recurso de IA.">
          <dl className="grid gap-6 sm:grid-cols-3">
            <div><dt className={`${labelClass} text-[10px] text-muted-foreground`}>Impressões</dt><dd className="mt-1 text-2xl font-medium tabular-nums">{int.format(s.ai.impressions)}</dd><dd className="mt-1"><Delta now={s.ai.impressions} before={s.ai.prevImpressions} /></dd></div>
            <div><dt className={`${labelClass} text-[10px] text-muted-foreground`}>Páginas com impressão</dt><dd className="mt-1 text-2xl font-medium tabular-nums">{int.format(s.ai.pages)}</dd>{s.ai.pages >= 1000 ? <dd className="mt-1 text-xs text-muted-foreground">O export lista no máximo 1.000 páginas: o número real pode ser maior.</dd> : null}</div>
            <div><dt className={`${labelClass} text-[10px] text-muted-foreground`}>Por dispositivo</dt><dd className="mt-1 space-y-0.5 text-sm">{s.ai.devices.map((d) => (<p key={d.key} className="flex justify-between gap-4"><span>{DEVICE[d.key] ?? d.key}</span><span className="font-mono tabular-nums">{int.format(d.impressions)}</span></p>))}</dd></div>
          </dl>
          {s.ai.topPages && s.ai.topPages.length > 0 ? (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead><tr className={`${labelClass} border-b border-border text-left text-[10px] text-muted-foreground`}><th scope="col" className="w-10 py-2 pr-2 font-medium">#</th><th scope="col" className="py-2 pr-3 font-medium">Página</th><th scope="col" className="py-2 pr-3 text-right font-medium">Impressões em IA</th><th scope="col" className="py-2 text-right font-medium">Vs anterior</th></tr></thead>
                <tbody>
                  {s.ai.topPages.map((p, i) => (
                    <tr key={p.key} className="border-b border-border/60 last:border-0">
                      <td className="py-2.5 pr-2 font-mono text-[11px] text-muted-foreground tabular-nums">{i + 1}</td>
                      <th scope="row" className="max-w-[28rem] truncate py-2.5 pr-3 text-left font-normal" title={p.key}>{shortUrl(p.key, s.property)}</th>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums">{int.format(p.impressions)}</td>
                      <td className="py-2.5 text-right"><RowDelta now={p.impressions} before={p.prevImpressions} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {s.ai.countries.length > 0 ? <p className="mt-4 text-xs text-muted-foreground">Por país: {s.ai.countries.map((c) => `${c.key} ${int.format(c.impressions)}`).join(" · ")}.</p> : null}
        </Panel>
      ) : null}
    </div>
  );
}
