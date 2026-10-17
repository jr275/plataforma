import type { GscDailyPoint } from "@plataforma/api";

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const dec = (n: number, d = 1) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const br = (iso: string) => iso.split("-").reverse().join("/");
const day = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/** Média dos últimos 7 DIAS DE CALENDÁRIO (não das últimas 7 linhas): se faltar um dia no export, a janela não esconde o buraco. */
export function rolling(points: readonly GscDailyPoint[], pick: (window: readonly GscDailyPoint[]) => number): { date: string; value: number }[] {
  return points.map((p, i) => {
    const d = day(p.date);
    const window = points.slice(0, i + 1).filter((q) => d - day(q.date) <= 6);
    return { date: p.date, value: pick(window) };
  });
}
export const meanClicks = (w: readonly GscDailyPoint[]) => w.reduce((s, p) => s + p.clicks, 0) / w.length;
/** Posição média ponderada por impressões (a mesma definição do total). */
export const weightedPosition = (w: readonly GscDailyPoint[]) => {
  const impressions = w.reduce((s, p) => s + p.impressions, 0);
  return impressions > 0 ? w.reduce((s, p) => s + p.position * p.impressions, 0) / impressions : 0;
};

const W = 800, H = 220, PAD = { l: 52, r: 12, t: 12, b: 26 };

/** Quebra a linha onde faltam dias: não se liga um ponto ao outro por cima de um buraco. */
function segments(series: readonly { date: string; value: number }[], x: (d: string) => number, y: (v: number) => number): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  series.forEach((p, i) => {
    if (i > 0 && day(p.date) - day(series[i - 1]!.date) > 1) { if (cur.length) out.push(cur.join(" ")); cur = []; }
    cur.push(`${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`);
  });
  if (cur.length) out.push(cur.join(" "));
  return out;
}

function Chart({ title, label, raw, smooth, invert = false, unit }: { title: string; label: string; raw?: { date: string; value: number }[]; smooth: { date: string; value: number }[]; invert?: boolean; unit: (v: number) => string }) {
  const all = [...(raw ?? []), ...smooth].map((p) => p.value);
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const d0 = day(smooth[0]!.date), d1 = day(smooth.at(-1)!.date), dspan = d1 - d0 || 1;
  const x = (d: string) => PAD.l + ((day(d) - d0) / dspan) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (invert ? (v - lo) / span : 1 - (v - lo) / span) * (H - PAD.t - PAD.b);
  return (
    <figure className="m-0">
      <figcaption className="mb-2 font-mono text-[11px] tracking-[0.08em] uppercase text-muted-foreground">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        <title>{label}</title>
        {[0, 0.5, 1].map((f) => {
          const v = invert ? lo + f * span : hi - f * span;
          const yy = PAD.t + f * (H - PAD.t - PAD.b);
          return (<g key={f}><line x1={PAD.l} x2={W - PAD.r} y1={yy} y2={yy} className="stroke-border" strokeWidth={1} /><text x={PAD.l - 6} y={yy + 3} textAnchor="end" className="fill-muted-foreground font-mono" fontSize={10}>{unit(v)}</text></g>);
        })}
        {raw ? segments(raw, x, y).map((pts, i) => <polyline key={`r${i}`} points={pts} fill="none" className="stroke-muted-foreground/40" strokeWidth={1} />) : null}
        {segments(smooth, x, y).map((pts, i) => <polyline key={`s${i}`} points={pts} fill="none" className="stroke-brand" strokeWidth={2} strokeLinejoin="round" />)}
        <text x={PAD.l} y={H - 6} className="fill-muted-foreground font-mono" fontSize={10}>{br(smooth[0]!.date)}</text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-muted-foreground font-mono" fontSize={10}>{br(smooth.at(-1)!.date)}</text>
      </svg>
    </figure>
  );
}

export function DailyCharts({ points }: { points: readonly GscDailyPoint[] }) {
  const clicksRaw = points.map((p) => ({ date: p.date, value: p.clicks }));
  const clicks7 = rolling(points, meanClicks);
  const pos7 = rolling(points, weightedPosition);
  const first = points[0]!, last = points.at(-1)!;
  const peak = points.reduce((m, p) => (p.clicks > m.clicks ? p : m), first);
  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-muted-foreground" data-testid="daily-summary">
        {int.format(points.length)} dias, de {br(first.date)} a {br(last.date)}. Maior dia: {br(peak.date)}, com {int.format(peak.clicks)} cliques.
      </p>
      <Chart title="Cliques por dia" label={`Cliques por dia de ${br(first.date)} a ${br(last.date)}: linha clara por dia, linha forte com a média de 7 dias`} raw={clicksRaw} smooth={clicks7} unit={(v) => int.format(v)} />
      <Chart title="Posição média (média de 7 dias, ponderada por impressões)" label={`Posição média de ${br(first.date)} a ${br(last.date)}, média de 7 dias; eixo invertido, posição menor fica no alto`} smooth={pos7} invert unit={(v) => dec(v, 1)} />
      <p className="text-xs text-muted-foreground">Linha clara: valor de cada dia. Linha forte: média dos últimos 7 dias de calendário. No gráfico de posição o eixo é invertido: quanto mais alto, melhor. Se faltar algum dia no export, a linha é interrompida em vez de ligar os pontos.</p>
    </div>
  );
}
