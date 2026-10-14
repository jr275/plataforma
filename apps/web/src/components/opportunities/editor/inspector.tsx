"use client";

import { useState } from "react";
import { ALLOWED_EDGES, CONTRACTS, connect, derivedFields, disconnect, fieldOptions, removeNode, updateConfig, type Config, type DraftContext, type ExecState, type FieldSpec, type Issue, type OpResult, type PageDraft } from "@plataforma/api/src/draft";
import type { Blueprint } from "@plataforma/api/src/engine/blueprint";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { EXEC_DOT, EXEC_LABEL, VALIDITY_LABEL } from "./status";

// Inspector contextual: formulário GERADO a partir do contrato do tipo de nó. Só existem campos do contrato; os fixos aparecem bloqueados; os derivados, só leitura.
function Field({ spec, value, options, onCommit }: { spec: FieldSpec; value: Config[string] | undefined; options: readonly string[] | null; onCommit: (v: Config[string]) => void }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const id = `f-${spec.key}`;
  const label = <label htmlFor={id} className="block text-[12px] font-medium">{spec.label}{spec.required ? <span aria-hidden="true" className="text-destructive"> *</span> : null}</label>;
  const hint = <p className="text-[11px] text-muted-foreground">{spec.hint}</p>;
  if (spec.locked) return <div className="space-y-1">{label}<input id={id} value={String(value ?? "")} disabled readOnly className={`${inputClass} opacity-70`} />{hint}</div>;
  if (spec.kind === "bool") return <div className="space-y-1"><label className="flex items-center gap-2 text-[12px] font-medium"><input type="checkbox" id={id} checked={value === true} onChange={(e) => onCommit(e.target.checked)} className="size-4" />{spec.label}</label>{hint}</div>;
  if (spec.kind === "enum") return <div className="space-y-1">{label}<select id={id} value={String(value ?? "")} onChange={(e) => onCommit(e.target.value)} className={inputClass}><option value="">{spec.required ? "— escolha —" : "—"}</option>{(options ?? []).map((o) => (<option key={o} value={o}>{o}</option>))}{value && !(options ?? []).includes(String(value)) ? <option value={String(value)}>{String(value)} (inválido)</option> : null}</select>{hint}</div>;
  if (spec.kind === "list") { const cur = new Set((value as readonly string[] | undefined) ?? []); return (
    <fieldset className="space-y-1"><legend className="text-[12px] font-medium">{spec.label}{spec.required ? <span aria-hidden="true" className="text-destructive"> *</span> : null}</legend>
      {(options ?? []).length === 0 ? <p className="text-[11px] text-muted-foreground">Sem opções neste contexto.</p> : (options ?? []).map((o) => (<label key={o} className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={cur.has(o)} onChange={(e) => { const n = new Set(cur); if (e.target.checked) n.add(o); else n.delete(o); onCommit([...(options ?? [])].filter((x) => n.has(x))); }} className="size-4" /><span className="font-mono text-[11px]">{o}</span></label>))}
      {hint}</fieldset>); }
  const commit = () => { if (spec.kind === "number") { const n = Number(text); onCommit(text.trim() !== "" && Number.isFinite(n) && /^-?\d+$/.test(text.trim()) ? n : text); } else onCommit(text); };
  return <div className="space-y-1">{label}<input id={id} value={text} inputMode={spec.kind === "number" ? "numeric" : undefined} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} maxLength={spec.max && spec.kind === "text" ? spec.max + 20 : undefined} className={inputClass} />{hint}</div>;
}

export function Inspector({ draft, ctx, base, nodeId, edgeId, exec, issues, apply, onSelect }: {
  draft: PageDraft; ctx: DraftContext; base: Blueprint; nodeId: string | null; edgeId: string | null; exec: Record<string, ExecState>; issues: readonly Issue[];
  apply: (f: (d: PageDraft) => OpResult) => void; onSelect: (id: string | null) => void;
}) {
  const [target, setTarget] = useState("");
  const edge = edgeId ? draft.edges.find((e) => e.id === edgeId) : undefined;
  if (edge) {
    const a = draft.nodes.find((n) => n.id === edge.from)!, b = draft.nodes.find((n) => n.id === edge.to)!;
    const r = disconnect(draft, edge.id);
    return (
      <div className="space-y-3 text-sm" data-testid="inspector"><h3 className="font-mono text-[11px] font-semibold tracking-wide uppercase">Conexão</h3>
        <p><strong>{CONTRACTS[a.type].label}</strong> <span className="font-mono text-[11px]">({a.id})</span> → <strong>{CONTRACTS[b.type].label}</strong> <span className="font-mono text-[11px]">({b.id})</span></p>
        <Button type="button" variant="outline" disabled={!r.ok} onClick={() => apply((d) => disconnect(d, edge.id))}>Remover conexão</Button>
        {!r.ok ? <p className="text-xs text-muted-foreground">{r.error}.</p> : null}
      </div>
    );
  }
  const node = nodeId ? draft.nodes.find((n) => n.id === nodeId) : undefined;
  if (!node) return <div data-testid="inspector" className="space-y-2 text-sm"><h3 className="font-mono text-[11px] font-semibold tracking-wide uppercase">Inspector</h3><p className="text-xs text-muted-foreground">Selecione um nó no canvas ou na lista para ver e editar a configuração dele. Só os campos do contrato do tipo são editáveis.</p></div>;
  const k = CONTRACTS[node.type];
  const st = exec[node.id];
  const mine = issues.filter((i) => i.nodeId === node.id);
  const derived = derivedFields(node, ctx, base, st);
  const out = draft.edges.filter((e) => e.from === node.id), inn = draft.edges.filter((e) => e.to === node.id);
  const targets = draft.nodes.filter((n) => ALLOWED_EDGES.some(([x, y]) => x === node.type && y === n.type) && connect(draft, node.id, n.id).ok);
  const rm = removeNode(draft, node.id);
  const label = (id: string) => { const n = draft.nodes.find((x) => x.id === id)!; return `${CONTRACTS[n.type].label} · ${id}`; };
  return (
    <div className="space-y-4 text-sm" data-testid="inspector" data-node={node.id}>
      <div><h3 className="font-mono text-[11px] font-semibold tracking-wide uppercase">{k.label}</h3><p className="font-mono text-[10.5px] text-muted-foreground">{node.id}</p><p className="mt-1 text-xs text-muted-foreground">{k.describe}</p></div>
      {st ? <p className="flex items-start gap-1.5 text-xs"><span aria-hidden="true" className={`mt-1 size-2 shrink-0 rounded-full ${EXEC_DOT[st.status]}`} /><span><strong className="uppercase">{EXEC_LABEL[st.status]}</strong> — {st.detail}</span></p> : null}
      <p className="text-xs text-muted-foreground">Validade: {VALIDITY_LABEL[mine.some((i) => i.severity === "error") ? "error" : mine.some((i) => i.severity === "warning") ? "warning" : "ok"]}</p>
      {mine.length ? <ul className="space-y-1 text-xs">{mine.map((i, n) => (<li key={n} className={i.severity === "error" ? "text-destructive" : i.severity === "warning" ? "text-warning" : "text-muted-foreground"}>{i.severity === "error" ? "Erro" : i.severity === "warning" ? "Aviso" : "Nota"}: {i.message}</li>))}</ul> : null}
      {k.fields.length ? <form className="space-y-3" aria-label="Configuração do nó" onSubmit={(e) => e.preventDefault()}>{k.fields.map((f) => (<Field key={`${node.id}-${f.key}-${JSON.stringify(node.config[f.key] ?? null)}`} spec={f} value={node.config[f.key]} options={fieldOptions(f, node, draft, ctx)} onCommit={(v) => apply((d) => { const n = d.nodes.find((x) => x.id === node.id)!; return JSON.stringify(n.config[f.key]) === JSON.stringify(v) ? { ok: true, draft: d } : updateConfig(d, node.id, { [f.key]: v }); })} />))}</form> : <p className="text-xs text-muted-foreground">Este nó não tem campos editáveis: tudo nele é derivado.</p>}
      {Object.keys(derived).length ? <dl className="space-y-1.5 border-t border-border pt-3 text-xs">{Object.entries(derived).map(([a, b]) => (<div key={a}><dt className="font-mono text-[10px] tracking-wide text-muted-foreground uppercase">{a} (derivado)</dt><dd className="break-words">{b}</dd></div>))}</dl> : null}
      <div className="space-y-2 border-t border-border pt-3">
        <h4 className="font-mono text-[10.5px] font-semibold tracking-wide uppercase">Conexões</h4>
        {inn.length + out.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma.</p> : <ul className="space-y-1 text-xs">{inn.map((e) => (<li key={e.id} className="flex items-center justify-between gap-2"><span>← {label(e.from)}</span><button type="button" className="underline underline-offset-2 disabled:no-underline disabled:opacity-40" disabled={!disconnect(draft, e.id).ok} onClick={() => apply((d) => disconnect(d, e.id))} aria-label={`Remover conexão vinda de ${label(e.from)}`}>remover</button></li>))}{out.map((e) => (<li key={e.id} className="flex items-center justify-between gap-2"><span>→ {label(e.to)}</span><button type="button" className="underline underline-offset-2 disabled:no-underline disabled:opacity-40" disabled={!disconnect(draft, e.id).ok} onClick={() => apply((d) => disconnect(d, e.id))} aria-label={`Remover conexão para ${label(e.to)}`}>remover</button></li>))}</ul>}
        {targets.length ? <div className="flex gap-2"><label className="sr-only" htmlFor="connect-target">Conectar a</label><select id="connect-target" value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}><option value="">Conectar a…</option>{targets.map((n) => (<option key={n.id} value={n.id}>{label(n.id)}</option>))}</select><Button type="button" variant="outline" disabled={!target} onClick={() => { apply((d) => connect(d, node.id, target)); setTarget(""); }}>Conectar</Button></div> : <p className="text-[11px] text-muted-foreground">Nenhuma conexão nova é permitida a partir deste nó.</p>}
      </div>
      <div className="border-t border-border pt-3"><Button type="button" variant="outline" disabled={!rm.ok} onClick={() => { apply((d) => removeNode(d, node.id)); onSelect(null); }}>Remover nó</Button>{!rm.ok ? <p className="mt-1 text-[11px] text-muted-foreground">{rm.error}.</p> : null}</div>
    </div>
  );
}
