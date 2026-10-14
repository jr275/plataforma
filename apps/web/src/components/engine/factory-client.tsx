"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { analyzeArchitectureAction, cancelBatchAction, setMinInlinksAction, confirmBatchAction, createDeploymentAction, decidePagesAction, planBatchAction, refreshDeploymentAction, startBatchAction, verifyDeploymentAction, type FactoryState } from "@/app/(app)/engine/factory-actions";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";

function Feedback({ state }: { state: FactoryState }) {
  return (
    <div aria-live="polite" className="space-y-1">
      {state?.error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{state.error}</p> : null}
      {state?.ok ? <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">{state.ok}{state.href ? <> <Link href={state.href} className="underline">Abrir</Link></> : null}</p> : null}
      {state?.items?.some((i) => !i.ok) ? <ul className="list-disc pl-5 text-[11px] text-muted-foreground">{state.items.filter((i) => !i.ok).slice(0, 8).map((i) => <li key={i.id}>{i.id.slice(0, 8)}…: {i.message}</li>)}</ul> : null}
    </div>
  );
}
const Spin = ({ pending }: { pending: boolean }) => (pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : null);

/** Atualização controlada: só enquanto o backend diz que há processamento em andamento; para sozinha quando terminar. */
export function AutoRefresh({ active, everyMs = 3000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => { if (!active) return; const t = setInterval(() => router.refresh(), everyMs); return () => clearInterval(t); }, [active, everyMs, router]);
  return active ? <p role="status" className="text-[11px] text-muted-foreground">Atualizando a cada {everyMs / 1000} s enquanto houver processamento (estado lido do banco).</p> : null;
}

/** Ações em lote sobre as páginas marcadas na tabela (as caixas usam form="decide-form"). Valida e confirma; cada página é processada à parte. */
export function PageBatchForm() {
  const [state, action, pending] = useActionState<FactoryState, FormData>(decidePagesAction, null);
  return (
    <form id="decide-form" action={action} noValidate className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-xs font-medium">Ação em lote nas páginas marcadas</p>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <select name="decision" className={inputClass} aria-label="Decisão"><option value="APPROVED">Aprovar (para revisão; não publica)</option><option value="REJECTED">Rejeitar</option><option value="REVOKED">Revogar aprovação</option></select>
        <input name="reason" maxLength={1000} placeholder="Motivo (fica na auditoria)" className={inputClass} aria-label="Motivo" />
      </div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirm" className="size-4" /> Confirmo a ação sobre as páginas marcadas.</label>
      <Button type="submit" size="sm" disabled={pending} aria-busy={pending}><Spin pending={pending} />Aplicar</Button>
      <Feedback state={state} />
    </form>
  );
}

const WIDTH = { desktop: "100%", tablet: "768px", mobile: "375px" } as const;
/** Preview do documento renderizado pelo renderer único. O iframe é sandbox sem scripts; a largura simula o dispositivo; as anotações mostram origem, referências e módulos omitidos. */
export function DevicePreview({ clean, annotated, title }: { clean: string; annotated: string; title: string }) {
  const [device, setDevice] = useState<keyof typeof WIDTH>("desktop"); const [notes, setNotes] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs" role="group" aria-label="Dispositivo do preview">
        {(["desktop", "tablet", "mobile"] as const).map((d) => <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} className={`rounded-md border px-2 py-1 ${device === d ? "border-foreground bg-muted font-medium" : "border-border"}`}>{d === "desktop" ? "Desktop" : d === "tablet" ? "Tablet (768 px)" : "Mobile (375 px)"}</button>)}
        <label className="ml-auto flex items-center gap-1.5"><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} className="size-4" /> Mostrar origem dos blocos e módulos omitidos</label>
      </div>
      <div className="overflow-auto rounded-lg border border-border bg-muted/40 p-2">
        <iframe title={`Preview: ${title}`} sandbox="" srcDoc={notes ? annotated : clean} style={{ width: WIDTH[device], maxWidth: "100%" }} className="mx-auto block h-[560px] border-0 bg-white" />
      </div>
    </div>
  );
}

export function BatchPlanForm({ families, templates, llmConfigured }: { families: readonly string[]; templates: readonly string[]; llmConfigured: boolean }) {
  const [state, action, pending] = useActionState<FactoryState, FormData>(planBatchAction, null);
  return (
    <form action={action} noValidate className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="b-name" label="Nome do lote"><input id="b-name" name="name" maxLength={120} className={inputClass} /></Field>
        <Field id="b-limit" label="Quantidade de páginas candidatas" hint="Máx. 2000. Candidata não é página aprovada."><input id="b-limit" name="limit" type="number" min={1} max={2000} defaultValue={50} className={inputClass} /></Field>
        <Field id="b-fam" label="Page families (vírgula; vazio = todas)" hint={`Disponíveis: ${families.join(", ") || "nenhuma"}`}><input id="b-fam" name="families" className={inputClass} /></Field>
        <Field id="b-tpl" label="Templates permitidos (vírgula; vazio = todos)" hint={`Com blueprint: ${templates.join(", ") || "nenhum ainda"}`}><input id="b-tpl" name="templates" className={inputClass} /></Field>
        <Field id="b-uf" label="Escopo geográfico (UF)"><input id="b-uf" name="uf" maxLength={2} placeholder="SP" className={inputClass} /></Field>
        <Field id="b-tgt" label="Destino do deployment" hint="Produção exige autorização explícita ao confirmar."><select id="b-tgt" name="target" defaultValue="preview" className={inputClass}><option value="none">Nenhum (só gerar)</option><option value="preview">Preview (padrão)</option><option value="production">Produção</option></select></Field>
        <Field id="b-conc" label="Limite de concorrência" hint="1 a 8 páginas ao mesmo tempo."><input id="b-conc" name="concurrency" type="number" min={1} max={8} defaultValue={2} className={inputClass} /></Field>
        <Field id="b-size" label="Tamanho do lote"><input id="b-size" name="batchSize" type="number" min={1} max={100} defaultValue={10} className={inputClass} /></Field>
        <Field id="b-calls" label="Limite de chamadas ao modelo por página" hint="Custo em dinheiro e tokens não são limitáveis: o provedor não os devolve a este pipeline."><input id="b-calls" name="maxModelCalls" type="number" min={1} max={200} defaultValue={40} className={inputClass} /></Field>
      </div>
      <p className="text-xs text-muted-foreground">Política de QA: padrão do pack (Q1–Q14; bloqueantes Q1, Q2, Q8, Q13). Política de aprovação: manual. Modo: {llmConfigured ? "real" : "real, mas SEM chave de LLM (agentes bloqueados)"}.</p>
      <Button type="submit" disabled={pending} aria-busy={pending}><Spin pending={pending} />Selecionar, validar e estimar</Button>
      <Feedback state={state} />
    </form>
  );
}
export function BatchControls({ id, status, target, awaiting }: { id: string; status: string; target: string; awaiting: number }) {
  const [c, confirm, cp] = useActionState<FactoryState, FormData>(confirmBatchAction, null); const [s, start, sp] = useActionState<FactoryState, FormData>(startBatchAction, null); const [x, cancel, xp] = useActionState<FactoryState, FormData>(cancelBatchAction, null);
  return (
    <div className="space-y-3">
      {status === "PLANNED" ? <form action={confirm} className="space-y-2"><input type="hidden" name="id" value={id} />{target === "production" ? <Field id="auth" label="Autorização de produção" hint="Digite exatamente: AUTORIZO PRODUÇÃO"><input id="auth" name="authorization" className={inputClass} /></Field> : null}<p className="text-xs">Confirmar registra quem confirmou, os limites e o destino ({target}). Nada executa até “Iniciar”.</p><Button type="submit" disabled={cp}><Spin pending={cp} />Confirmar lote</Button><Feedback state={c} /></form> : null}
      {["CONFIRMED", "CANCELLED", "RUNNING", "COMPLETED", "FAILED"].includes(status) ? <form action={start} className="space-y-2"><input type="hidden" name="id" value={id} />{awaiting > 0 ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="reprocess" className="size-4" /> Reprocessar as {awaiting} página(s) que pararam em revisão humana (ex.: depois de registrar a exceção de SERP)</label> : null}<Button type="submit" variant={status === "CONFIRMED" ? "default" : "outline"} disabled={sp}><Spin pending={sp} />{status === "CONFIRMED" ? "Iniciar geração" : "Retomar / retentar"}</Button><Feedback state={s} /></form> : null}
      {["CONFIRMED", "RUNNING"].includes(status) ? <form action={cancel} className="space-y-1"><input type="hidden" name="id" value={id} /><Button type="submit" size="sm" variant="outline" disabled={xp}><Spin pending={xp} />Cancelar</Button><Feedback state={x} /></form> : null}
    </div>
  );
}
export function DeployForm({ children }: { children: React.ReactNode }) {
  const [state, action, pending] = useActionState<FactoryState, FormData>(createDeploymentAction, null);
  const [target, setTarget] = useState("preview");
  return (
    <form action={action} noValidate className="space-y-3">
      {children}
      <Field id="d-target" label="Destino"><select id="d-target" name="target" value={target} onChange={(e) => setTarget(e.target.value)} className={inputClass}><option value="preview">Preview (padrão)</option><option value="production">Produção (exige autorização)</option></select></Field>
      {target === "production" ? <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3"><Field id="d-phrase" label="Digite AUTORIZO PRODUÇÃO"><input id="d-phrase" name="phrase" className={inputClass} /></Field><Field id="d-reason" label="Motivo da publicação (mín. 10 caracteres; fica na auditoria)"><input id="d-reason" name="reason" maxLength={500} className={inputClass} /></Field></div> : null}
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="confirm" className="mt-0.5 size-4" /><span>Confirmo: enviar as páginas marcadas para <strong>{target === "production" ? "PRODUÇÃO" : "preview"}</strong>. Aceite pela Vercel não é sucesso; a verificação é um passo à parte.</span></label>
      <Button type="submit" disabled={pending} aria-busy={pending}><Spin pending={pending} />Enviar para a Vercel</Button>
      <Feedback state={state} />
    </form>
  );
}
export function DeploymentControls({ id, status }: { id: string; status: string }) {
  const [r, refresh, rp] = useActionState<FactoryState, FormData>(refreshDeploymentAction, null); const [v, verify, vp] = useActionState<FactoryState, FormData>(verifyDeploymentAction, null);
  const final = ["FAILED", "CANCELED", "VERIFIED"].includes(status);
  return (
    <div className="flex flex-wrap items-start gap-3">
      {!final ? <form action={refresh} className="space-y-1"><input type="hidden" name="id" value={id} /><Button type="submit" size="sm" variant="outline" disabled={rp}><Spin pending={rp} />Consultar a Vercel</Button><Feedback state={r} /></form> : null}
      {["READY", "VERIFICATION_PENDING"].includes(status) ? <form action={verify} className="space-y-1"><input type="hidden" name="id" value={id} /><Button type="submit" size="sm" disabled={vp}><Spin pending={vp} />Verificar URLs</Button><Feedback state={v} /></form> : null}
    </div>
  );
}

/** Reanalisar a arquitetura e ajustar o mínimo de inlinks. Nada aqui gera, aprova ou publica páginas. */
export function ArchitectureControls({ minInlinks }: { minInlinks: number }) {
  const [a, runA, pa] = useActionState<FactoryState, FormData>(analyzeArchitectureAction, null);
  const [m, runM, pm] = useActionState<FactoryState, FormData>(setMinInlinksAction, null);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <form action={runA} className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-xs font-medium">Reanalisar arquitetura</p>
        <p className="text-[11px] text-muted-foreground">Recalcula o grafo de links e o Quality Gate de todas as páginas com recipe. Só grava um resultado novo quando algo mudou. Não gera, não aprova e não publica.</p>
        <Button type="submit" size="sm" disabled={pa}><Spin pending={pa} />Reanalisar</Button>
        <Feedback state={a} />
      </form>
      <form action={runM} noValidate className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-xs font-medium">Mínimo de inlinks contextuais</p>
        <div className="grid gap-2 sm:grid-cols-[6rem_1fr]">
          <input name="minInlinks" type="number" min={1} max={20} defaultValue={minInlinks} className={inputClass} aria-label="Mínimo de inlinks" />
          <input name="note" maxLength={300} placeholder="Motivo (fica na auditoria)" className={inputClass} aria-label="Motivo da alteração" />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pm}><Spin pending={pm} />Salvar política</Button>
        <Feedback state={m} />
      </form>
    </div>
  );
}
