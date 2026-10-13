"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { DataStateBadge, GateIcon, Section, StateNotice, gateLabel } from "@/components/intel/primitives";
import { ARCHETYPES, moduleLabel, rankArchetypes, requirementLabel, type ModuleId } from "@/lib/intel/archetypes";
import { GATE_CATEGORIES, UNVERIFIED_STATES, defaultBlueprint, evaluateGates, publicationLabel, publicationStateOf, type Blueprint } from "@/lib/intel/blueprint";
import { cn } from "@/lib/utils";

const ALL_MODULES = Object.keys(moduleLabel) as ModuleId[];
const stateTone = { draft: "neutral", needs_evidence: "warning", blocked: "danger", ready_for_review: "success", approved: "success", published: "success", monitoring: "info" } as const;

export function BlueprintStudio() {
  const { current } = useAppState();
  const router = useRouter();
  const oParam = useSearchParams().get("o");
  const active = current.opportunities.filter((o) => o.status !== "dismissed");
  const o = active.find((x) => x.id === oParam) ?? active[0];
  const ranked = useMemo(() => (o ? rankArchetypes(current, o) : []), [current, o]);
  const [overrides, setOverrides] = useState<Record<string, Blueprint>>({});
  if (!o) return <StateNotice state="empty" title="Nenhuma oportunidade ativa para montar um blueprint." />;

  const bp = overrides[o.id] ?? defaultBlueprint(o, ranked[0].archetype);
  const update = (patch: Partial<Blueprint>) => setOverrides((p) => ({ ...p, [o.id]: { ...bp, ...patch } }));
  const archetype = ARCHETYPES.find((a) => a.id === bp.archetypeId)!;
  const rec = ranked.find((r) => r.archetype.id === bp.archetypeId)!;
  const checks = evaluateGates(current, o, bp);
  const state = publicationStateOf(checks);
  const toggleModule = (m: ModuleId) => update({ modules: bp.modules.includes(m) ? bp.modules.filter((x) => x !== m) : [...bp.modules, m] });
  const counts = { pass: 0, fail: 0, warning: 0, not_evaluated: 0 };
  for (const c of checks) counts[c.result]++;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        crumbs={[{ label: "Experience Factory" }, { label: "Page Blueprints" }]}
        title="Blueprint Studio"
        description="Escolha o formato da experiência, os módulos e o próximo passo. O Quality Gate avalia o blueprint contra os dados reais do workspace."
        badges={<><DataStateBadge state="derived" /><span className="text-xs text-muted-foreground">Rascunho local, não salvo</span></>}
      />

      <label className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:max-w-xl">
        Oportunidade
        <select value={o.id} onChange={(e) => router.replace(`/blueprints?o=${e.target.value}`)} className="h-9 border border-input bg-card px-2.5 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {active.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
        </select>
      </label>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4 border border-border bg-card p-4">
          <Section title="Arquétipo">
            <ul className="flex flex-col gap-1.5" role="radiogroup" aria-label="Arquétipo">
              {ranked.map((r) => (
                <li key={r.archetype.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={r.archetype.id === bp.archetypeId}
                    onClick={() => update({ archetypeId: r.archetype.id, modules: r.archetype.modules })}
                    className={cn("flex w-full items-center justify-between gap-2 border px-2.5 py-2 text-left text-[13px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", r.archetype.id === bp.archetypeId ? "border-brand bg-brand/10" : "border-border hover:bg-accent")}
                  >
                    <span className="min-w-0 truncate">{r.archetype.name}</span>
                    <span className="flex items-center gap-1.5">
                      {r.missing.length ? <span className="font-mono text-[10px] text-warning">−{r.missing.length}</span> : null}
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{Math.round(r.fit * 100)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Contrato de dados">
            <ul className="flex flex-col gap-1 text-xs">
              {archetype.requires.map((req) => (
                <li key={req} className={cn("flex gap-1.5", rec.missing.includes(req) ? "text-destructive" : "text-foreground")}>
                  <span aria-hidden="true">{rec.missing.includes(req) ? "✗" : "✓"}</span>{requirementLabel[req]}
                  <span className="sr-only">{rec.missing.includes(req) ? "(ausente)" : "(disponível)"}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Módulos">
            <ul className="flex flex-col gap-1">
              {ALL_MODULES.map((m) => (
                <li key={m}>
                  <label className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={bp.modules.includes(m)} onChange={() => toggleModule(m)} className="size-3.5 accent-[var(--brand)]" />
                    {moduleLabel[m]}
                  </label>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Chamada para ação">
            <input value={bp.cta} onChange={(e) => update({ cta: e.target.value })} aria-label="Texto da chamada para ação" className="h-8 w-full border border-input bg-background px-2 text-[13px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" />
          </Section>
        </div>

        <BlueprintPreview title={o.title} modules={bp.modules} cta={bp.cta} schemaType={archetype.schemaType} />

        <div className="flex flex-col border border-border bg-card xl:sticky xl:top-16 xl:max-h-[calc(100dvh-7rem)]">
          <div className="border-b border-border p-4">
            <p className="font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">Experience Quality Gate</p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <Badge tone={stateTone[state]}>{publicationLabel[state]}</Badge>
              <span className="font-mono text-[11px] text-muted-foreground">{counts.pass}✓ {counts.warning}! {counts.fail}✗ {counts.not_evaluated}○</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {UNVERIFIED_STATES.map((s) => publicationLabel[s]).join(", ")} só podem ser atribuídos com registro verificado; esta tela nunca os declara.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {GATE_CATEGORIES.map((cat) => (
              <Section key={cat} title={cat}>
                <ul className="flex flex-col gap-3">
                  {checks.filter((c) => c.category === cat).map((c) => (
                    <li key={c.id} className="flex gap-2">
                      <GateIcon result={c.result} className="mt-0.5" />
                      <div className="min-w-0 text-[13px]">
                        <p className="font-medium">{c.name}{c.critical ? <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">crítico</span> : null}<span className="sr-only">: {gateLabel(c.result)}</span></p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{c.explanation}</p>
                        {c.action ? <p className="mt-1 text-xs text-brand">{c.action}</p> : null}
                        <details className="mt-1">
                          <summary className="cursor-pointer font-mono text-[10.5px] text-muted-foreground">evidência</summary>
                          <pre className="mt-1 font-mono text-[10.5px] whitespace-pre-wrap text-muted-foreground">{c.evidence}</pre>
                        </details>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BlueprintPreview({ title, modules, cta, schemaType }: { title: string; modules: readonly ModuleId[]; cta: string; schemaType: string }) {
  return (
    <figure className="flex min-w-0 flex-col border border-border bg-card">
      <figcaption className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-mono text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">Pré-visualização estrutural</span>
        <span className="font-mono text-[10.5px] text-muted-foreground">schema.org/{schemaType}</span>
      </figcaption>
      <div className="flex flex-col gap-3 bg-background p-4 sm:p-6">
        <p className="text-xl leading-tight font-semibold text-balance">{title}</p>
        {modules.length === 0 ? <StateNotice state="empty" title="Nenhum módulo selecionado." /> : null}
        {modules.map((m) => (
          <div key={m} className={cn("border border-dashed border-border px-3 py-3", m === "cta" && "border-solid border-brand bg-brand/10")}>
            <p className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">{moduleLabel[m]}</p>
            {m === "cta" ? <p className="mt-1.5 text-sm font-medium text-brand">{cta || "Sem texto"}</p> : <ModuleSkeleton m={m} />}
          </div>
        ))}
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Estrutura apenas. O conteúdo é gerado só a partir de fatos verificados.</p>
    </figure>
  );
}

function ModuleSkeleton({ m }: { m: ModuleId }) {
  const bars = m === "dataTable" || m === "comparison" ? 4 : m === "faq" || m === "steps" ? 3 : 2;
  return (
    <div className={cn("mt-2 gap-1.5", m === "dataTable" || m === "comparison" ? "grid grid-cols-3" : "flex flex-col")} aria-hidden="true">
      {Array.from({ length: m === "dataTable" || m === "comparison" ? bars * 3 : bars }, (_, i) => (
        <span key={i} className="h-2 bg-muted" style={{ width: m === "dataTable" || m === "comparison" ? "100%" : `${90 - i * 18}%` }} />
      ))}
    </div>
  );
}
