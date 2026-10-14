import Link from "next/link";
import type { architecture } from "@plataforma/api";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { Dl } from "@/components/ui/field";
import { ArchitectureControls } from "./factory-client";
import { Stat, Pre, when } from "./engine-views";

// Content Architecture (ADR-033): clusters, política de links e o resultado do Quality Gate por página. Tudo vem do que o banco registrou; elegibilidade (aprovar, publicar, indexar) NUNCA é o mesmo que indexação observada.
const fmt = (n: number) => n.toLocaleString("pt-BR");
export const LEVEL_LABEL = { approval: "Aprovação", publication: "Publicação", indexing: "Indexação" } as const;
export const RULE_LABEL: Record<string, string> = {
  "contract.schema": "Schema do archetype", "contract.generation": "Dados mínimos para gerar", "contract.indexing": "Dados e proveniência para indexar", "contract.density": "Densidade de dados",
  "intent.conflict": "Conflito de intenção/URL", "entity.primary": "Entidade principal", "template.ready": "Template e módulos", "links.outlinks_valid": "Outlinks válidos", INSUFFICIENT_CONTEXTUAL_INLINKS: "Inlinks contextuais insuficientes", "links.inlinks_min": "Inlinks contextuais mínimos",
  "schema.hierarchy": "Hierarquia do JSON-LD", "approval.human": "Aprovação humana", "policy.index": "Política de indexação",
};
export const ruleLabel = (id: string) => RULE_LABEL[id] ?? id;
const stepTone = { PASSED: "success", FAILED: "danger", WARNING: "warning", SKIPPED: "neutral" } as const;
const stepLabel = { PASSED: "passou", FAILED: "reprovou", WARNING: "aviso", SKIPPED: "pulado" } as const;
const lvlTone = (ok: boolean) => (ok ? "success" : "danger") as "success" | "danger";

export function EligibilityBadges({ gate }: { gate: { approval: boolean; publication: boolean; indexing: boolean } | null }) {
  if (!gate) return <span className="text-muted-foreground">sem análise</span>;
  return <span className="flex flex-wrap gap-1" data-testid="eligibility">{(Object.keys(LEVEL_LABEL) as (keyof typeof LEVEL_LABEL)[]).map((k) => <Badge key={k} tone={lvlTone(gate[k])}>{LEVEL_LABEL[k]}: {gate[k] ? "liberada" : "bloqueada"}</Badge>)}</span>;
}

export function ClustersPanel({ clusters, minInlinks, archetypes }: { clusters: readonly architecture.ClusterRow[]; minInlinks: number; archetypes: readonly { id: string; name: string; version: string }[] }) {
  const total = clusters.reduce((a, c) => a + c.pages, 0);
  return (
    <>
      <Panel title="Clusters e archetypes" description="Cada página pertence a um cluster (intenção + escopo) e cumpre o contrato de um archetype. Elegível não é indexada: a indexação só é registrada quando observada.">
        <div className="mb-3 grid gap-3 sm:grid-cols-4">
          <Stat label="Clusters" value={fmt(clusters.length)} />
          <Stat label="Páginas analisadas" value={fmt(total)} />
          <Stat label="Elegíveis para aprovação" value={fmt(clusters.reduce((a, c) => a + c.eligibleApproval, 0))} />
          <Stat label="Elegíveis para indexação" value={fmt(clusters.reduce((a, c) => a + c.eligibleIndexing, 0))} hint="Não significa indexadas." />
        </div>
        {clusters.length === 0 ? <EmptyState title="Nenhuma página analisada ainda" hint="Use “Reanalisar” para calcular o grafo de links e o Quality Gate das páginas com recipe." /> : (
          <div className="overflow-x-auto"><table className="w-full text-xs" data-testid="clusters-table"><thead><tr className="text-left text-[11px] text-muted-foreground"><th className="py-1 pr-3">Cluster</th><th className="pr-3">Archetype</th><th className="pr-3">Intenção</th><th className="pr-3">Páginas</th><th className="pr-3">Aprovação</th><th className="pr-3">Indexação</th><th className="pr-3">Inlinks insuficientes</th><th className="pr-3">Conflitos</th><th>Qualidade média</th></tr></thead>
            <tbody>{clusters.map((c) => (
              <tr key={c.id} className="border-t border-border align-top">
                <td className="py-1.5 pr-3"><Link className="font-medium underline" href={`/engine/pages?cluster=${c.id}`}>{c.name}</Link><div className="text-[11px] text-muted-foreground">{c.domain} · {c.locale} · {c.market}</div></td>
                <td className="pr-3">{c.archetypeId}</td><td className="pr-3">{c.primaryIntent}</td>
                <td className="pr-3 tabular-nums">{fmt(c.pages)}</td><td className="pr-3 tabular-nums">{fmt(c.eligibleApproval)} de {fmt(c.pages)}</td><td className="pr-3 tabular-nums">{fmt(c.eligibleIndexing)} de {fmt(c.pages)}</td>
                <td className="pr-3 tabular-nums">{c.insufficientInlinks > 0 ? <Link className="underline" href={`/engine/pages?cluster=${c.id}&linkFailure=1`}>{fmt(c.insufficientInlinks)}</Link> : 0}</td>
                <td className="pr-3 tabular-nums">{c.withConflicts > 0 ? <Link className="underline" href={`/engine/pages?cluster=${c.id}&conflict=1`}>{fmt(c.withConflicts)}</Link> : 0}</td>
                <td className="tabular-nums">{c.avgQuality === null ? "—" : c.avgQuality.toFixed(2)}</td>
              </tr>))}</tbody></table></div>
        )}
      </Panel>
      <Panel title="Política de links e análise" description={`Mínimo vigente: ${minInlinks} inlink(s) contextual(is) válido(s) por página. Exceção só explícita (escopo, justificativa, responsável); falha = INSUFFICIENT_CONTEXTUAL_INLINKS.`}>
        <ArchitectureControls minInlinks={minInlinks} />
      </Panel>
      <Panel title="Archetypes disponíveis" description="Contratos configuráveis; o núcleo não conhece o domínio (o pack liga família → archetype).">
        <ul className="grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3" data-testid="archetype-list">{archetypes.map((a) => <li key={a.id} className="flex justify-between gap-2 rounded border border-border px-2 py-1"><span><strong>{a.id}</strong> {a.name}</span><span className="text-muted-foreground">v{a.version}</span></li>)}</ul>
      </Panel>
    </>
  );
}

const edgeRow = (e: architecture.StoredEdge, dir: "in" | "out") => (
  <li key={`${e.fromId}-${e.toPath}-${e.relation}-${e.moduleId ?? ""}`} className="flex flex-wrap items-center gap-2" data-edge-state={e.state}>
    <Badge tone={e.state === "VALID" ? "success" : "danger"}>{e.state === "VALID" ? "válido" : "inválido"}</Badge>
    <span className="font-mono">{dir === "in" ? (e.otherUrl ?? e.fromId.slice(0, 8)) : e.toPath}</span>
    <span className="text-muted-foreground">{e.relation}{e.moduleId ? ` · ${e.moduleId}` : ""}{e.invalidReason ? ` · ${e.invalidReason}` : ""}</span>
    <span className="basis-full text-[11px] text-muted-foreground">{e.reason}</span>
  </li>
);

export function ArchitectureSection({ a }: { a: architecture.StoredArchitecture | null }) {
  if (!a) return <Panel title="Arquitetura de conteúdo"><EmptyState title="Sem análise de arquitetura" hint="Esta página ainda não foi analisada (precisa de recipe e de archetype no pack). Use “Reanalisar” em Tópicos." /></Panel>;
  const g = a.gate; const ar = a.architecture;
  return (
    <div className="space-y-4" data-testid="architecture-section">
      <Panel title="Arquitetura de conteúdo" description={`Archetype ${ar.archetypeId} (contrato v${ar.contractVersion}) · cluster ${ar.clusterName ?? "—"} · intenção ${ar.primaryIntent}`} action={g?.qualityScore !== null && g ? <Badge tone="neutral">Qualidade {g.qualityScore?.toFixed(2)}</Badge> : undefined}>
        {g ? <EligibilityBadges gate={g.eligibility} /> : <EmptyState title="Sem resultado do Quality Gate" />}
        <p className="mt-2 text-[11px] text-muted-foreground">Elegibilidade para indexar não é indexação: o estado indexado só vem de observação registrada.</p>
        <Dl items={[{ label: "Canonical", value: ar.canonicalUrl ?? "—" }, { label: "Regra de canonical", value: ar.canonicalRule }, { label: "Domínio · locale · mercado", value: `${ar.domain} · ${ar.locale} · ${ar.market}` }, { label: "Evidência da intenção", value: ar.intentEvidence.join("; ") || "—" }, { label: "Analisada em", value: when(g?.createdAt ?? ar.createdAt) }]} />
      </Panel>
      {g ? (
        <Panel title="Quality Gate (10 passos)" description="Cada nível tem as suas regras bloqueantes. O que bloqueia um nível não bloqueia necessariamente os anteriores.">
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" data-testid="gate-steps">{g.steps.map((s) => <li key={s.n} className="rounded-lg border border-border p-2" data-step-status={s.status}><p className="text-[11px] text-muted-foreground">{s.n}. {s.name}</p><Badge tone={stepTone[s.status]}>{stepLabel[s.status]}</Badge></li>)}</ol>
          {(["approval", "publication", "indexing"] as const).map((k) => (
            <div key={k} className="mt-3 text-xs"><p className="font-medium">{LEVEL_LABEL[k]}: {g.eligibility[k] ? "liberada" : "bloqueada por"}</p>{g.blockedBy[k].length > 0 ? <ul className="mt-1 list-disc pl-5 text-muted-foreground">{g.blockedBy[k].map((r) => <li key={r}><code>{r}</code> — {ruleLabel(r)}</li>)}</ul> : null}</div>))}
          {g.nextActions.length > 0 ? <div className="mt-3 text-xs"><p className="font-medium">Próximas ações</p><ul className="mt-1 list-disc pl-5 text-muted-foreground" data-testid="next-actions">{g.nextActions.map((n) => <li key={n}>{n}</li>)}</ul></div> : null}
          {g.intentConflicts.length > 0 ? <div className="mt-3 text-xs" data-testid="conflicts"><p className="font-medium">Conflitos de intenção/URL</p><Pre v={g.intentConflicts} label={`${g.intentConflicts.length} conflito(s)`} /></div> : null}
          {g.schemaErrors.length > 0 ? <div className="mt-3 text-xs"><p className="font-medium">Erros de schema/JSON-LD</p><ul className="list-disc pl-5 text-muted-foreground">{g.schemaErrors.map((e) => <li key={e}>{e}</li>)}</ul></div> : null}
          {g.missingData.length > 0 ? <div className="mt-3 text-xs"><p className="font-medium">Dados ausentes</p><p className="text-muted-foreground">{g.missingData.join(", ")}</p></div> : null}
        </Panel>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Inlinks (${a.inlinks.length})`} description="Páginas que linkam para esta, com o contexto do link."><ul className="space-y-1.5 text-xs" data-testid="inlinks">{a.inlinks.length === 0 ? <li className="text-muted-foreground">Nenhuma página linka para esta.</li> : a.inlinks.map((e) => edgeRow(e, "in"))}</ul></Panel>
        <Panel title={`Outlinks (${a.outlinks.length})`} description="Links que esta página emite; só os válidos contam."><ul className="space-y-1.5 text-xs" data-testid="outlinks">{a.outlinks.length === 0 ? <li className="text-muted-foreground">Esta página não emite links.</li> : a.outlinks.map((e) => edgeRow(e, "out"))}</ul></Panel>
      </div>
    </div>
  );
}
