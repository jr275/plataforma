"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { activatePromptAction, cancelPipelineAction, registerPromptAction, rollbackPromptAction, runPagePipelineAction, syncRegistryAction, type EngineActionState } from "@/app/(app)/engine/actions";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";

function Feedback({ state }: { state: EngineActionState }) {
  return (
    <div aria-live="polite" className="space-y-1">
      {state?.error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{state.error}</p> : null}
      {state?.ok ? <p role="status" className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">{state.ok}{state.href ? <> <Link href={state.href} className="underline">Abrir a execução</Link></> : null}</p> : null}
    </div>
  );
}
const Spin = ({ pending }: { pending: boolean }) => (pending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : null);

export function SyncRegistryButton() {
  const [state, action, pending] = useActionState<EngineActionState, FormData>(() => syncRegistryAction(), null);
  return <form action={action} className="space-y-2"><Button type="submit" variant="outline" disabled={pending} aria-busy={pending}><Spin pending={pending} />Inicializar o registro a partir do código e do arquivo de prompts</Button><Feedback state={state} /></form>;
}
export function ActivatePromptButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<EngineActionState, FormData>(activatePromptAction, null);
  return <form action={action} className="space-y-1"><input type="hidden" name="id" value={id} /><Button type="submit" size="sm" variant="outline" disabled={pending} aria-busy={pending}><Spin pending={pending} />{label}</Button><Feedback state={state} /></form>;
}
export function RollbackPromptButton({ agent }: { agent: number }) {
  const [state, action, pending] = useActionState<EngineActionState, FormData>(rollbackPromptAction, null);
  return <form action={action} className="space-y-1"><input type="hidden" name="agent" value={agent} /><Button type="submit" size="sm" variant="outline" disabled={pending} aria-busy={pending}><Spin pending={pending} />Rollback para a versão anterior</Button><Feedback state={state} /></form>;
}
export function RegisterPromptForm({ agents }: { agents: readonly { agent: number; name: string }[] }) {
  const [state, action, pending] = useActionState<EngineActionState, FormData>(registerPromptAction, null);
  return (
    <form action={action} noValidate className="space-y-3">
      <Field id="rp-agent" label="Agente"><select id="rp-agent" name="agent" className={inputClass}>{agents.map((a) => <option key={a.agent} value={a.agent}>{a.agent} — {a.name}</option>)}</select></Field>
      <Field id="rp-body" label="Texto do prompt" hint="Só placeholders conhecidos ({{TENANT_NAME}}, {{DOMAIN_PACK}}… e a variável de entrada do agente). Nasce como RASCUNHO e só ativa com regressão aprovada."><textarea id="rp-body" name="body" rows={8} maxLength={60000} className={`${inputClass} h-auto py-2 font-mono text-xs`} /></Field>
      <Field id="rp-log" label="O que mudou e por quê"><input id="rp-log" name="changeLog" maxLength={2000} className={inputClass} /></Field>
      <Button type="submit" disabled={pending} aria-busy={pending}><Spin pending={pending} />Registrar rascunho</Button>
      <Feedback state={state} />
    </form>
  );
}
export function RunPipelineButton({ opportunityId }: { opportunityId: string }) {
  const [state, action, pending] = useActionState<EngineActionState, FormData>(runPagePipelineAction, null);
  return <form action={action} className="space-y-2"><input type="hidden" name="opportunityId" value={opportunityId} /><Button type="submit" disabled={pending} aria-busy={pending}><Spin pending={pending} />Executar o pipeline desta página</Button><p className="text-[11px] text-muted-foreground">Roda elegibilidade → blueprint → recipe → QA → Quality Gate. Sem chave de LLM os passos de agente ficam bloqueados externamente. Nada é publicado.</p><Feedback state={state} /></form>;
}
export function CancelPipelineButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<EngineActionState, FormData>(cancelPipelineAction, null);
  return <form action={action} className="space-y-1"><input type="hidden" name="id" value={id} /><Button type="submit" size="sm" variant="outline" disabled={pending} aria-busy={pending}><Spin pending={pending} />Cancelar execução</Button><Feedback state={state} /></form>;
}
