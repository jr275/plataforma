"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dl, Field, inputClass } from "@/components/ui/field";
import { ChipGroup } from "@/components/ui/filters";
import { Modal } from "@/components/ui/modal";
import { NotFoundState } from "@/components/ui/not-found-state";
import { OwnerNotice } from "@/components/ui/owner-notice";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { ResourceList } from "@/components/ui/resource-list";
import type { SourceHealth } from "@/data/demo/types";
import { findAcross } from "@/lib/find";

export const healthLabel: Record<SourceHealth, string> = { ok: "Saudável", stale: "Desatualizada", error: "Com erro", pending: "Simulada (não conectada)" };
export const healthTone = { ok: "success", stale: "warning", error: "danger", pending: "outline" } as const;
const TYPES = ["Banco de dados", "Planilha sincronizada", "API", "Arquivo"] as const;

function ConnectForm({ onDone }: { onDone: () => void }) {
  const { current, addSource, notify } = useAppState();
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("");
  const [target, setTarget] = useState("");
  const [errors, setErrors] = useState<{ name?: string; type?: string; target?: string }>({});
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (name.trim().length < 3) next.name = "Informe um nome com pelo menos 3 caracteres.";
    if (!type) next.type = "Escolha o tipo da fonte.";
    if (target.trim().length < 3) next.target = "Informe a referência (URL, caminho ou identificador).";
    setErrors(next);
    if (next.name || next.type || next.target) return;
    addSource(current.workspace.id, { id: `s-demo-${Date.now()}`, name: name.trim(), type, health: "pending", freshness: "nunca sincronizada", records: 0, description: `Fonte simulada. Referência informada: ${target.trim()}. Nenhuma conexão real foi feita.` });
    notify(`Fonte “${name.trim()}” adicionada como simulada. Nenhuma conexão real foi feita.`);
    onDone();
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field id="src-name" label="Nome" error={errors.name}><input id="src-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? "src-name-error" : undefined} className={inputClass} /></Field>
      <Field id="src-type" label="Tipo" error={errors.type}>
        <select id="src-type" value={type} onChange={(e) => setType(e.target.value)} aria-invalid={errors.type ? true : undefined} aria-describedby={errors.type ? "src-type-error" : undefined} className={inputClass}>
          <option value="">Selecione…</option>
          {TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
        </select>
      </Field>
      <Field id="src-target" label="Referência" hint="Não use credenciais reais: nada é enviado a lugar nenhum." error={errors.target}><input id="src-target" value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={errors.target ? true : undefined} aria-describedby={errors.target ? "src-target-error" : undefined} className={inputClass} /></Field>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onDone}>Cancelar</Button><Button type="submit">Adicionar fonte simulada</Button></div>
    </form>
  );
}

export function SourcesList() {
  const { current } = useAppState();
  const [health, setHealth] = useState<SourceHealth | "">("");
  const [open, setOpen] = useState(false);
  const rows = current.sources.filter((s) => !health || s.health === health);
  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Data Sources" }]}
        title="Fontes de dados"
        description={`De onde vem o que ${current.workspace.name} sabe. Status e atualidade de demonstração; nenhuma conexão real existe neste protótipo.`}
        actions={<Button size="lg" onClick={() => setOpen(true)}><Plus data-icon="inline-start" aria-hidden="true" />Conectar fonte (demo)</Button>}
      />
      <ChipGroup label="Filtrar por status" value={health} onChange={setHealth} allLabel="Todos os status" options={(Object.keys(healthLabel) as SourceHealth[]).map((h) => ({ value: h, label: healthLabel[h] }))} />
      <ResourceList
        rows={rows.map((s) => ({ id: s.id, href: `/data-sources/${s.id}`, title: s.name, subtitle: `${s.type} · ${s.records.toLocaleString("pt-BR")} registros`, badges: <Badge tone={healthTone[s.health]}>{healthLabel[s.health]}</Badge>, meta: s.freshness }))}
        empty={<EmptyState title="Nenhuma fonte com esse status" action={<Button variant="outline" size="sm" onClick={() => setHealth("")}>Limpar filtro</Button>} />}
        count={`${rows.length} de ${current.sources.length} fontes`}
      />
      <Modal open={open} onOpenChange={setOpen} title="Conectar fonte (demonstração)" description="Cria uma fonte SIMULADA só neste navegador. Nenhuma conexão, credencial ou dado real é usado."><ConnectForm onDone={() => setOpen(false)} /></Modal>
    </div>
  );
}

export function SourceDetail({ id }: { id: string }) {
  const { workspaces, current, notify } = useAppState();
  const found = findAcross(workspaces, "sources", id, current);
  if (!found) return <NotFoundState what="Fonte" backHref="/data-sources" backLabel="Voltar para Data Sources" />;
  const { owner, item: s } = found;
  const knowledge = owner.knowledge.filter((k) => k.sourceId === s.id);
  const opportunities = owner.opportunities.filter((o) => o.sourceIds.includes(s.id));
  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Data Sources", href: "/data-sources" }, { label: s.name }]}
        title={s.name}
        description={s.description}
        badges={<><Badge tone={healthTone[s.health]}>{healthLabel[s.health]}</Badge><Badge tone="outline">{s.type}</Badge></>}
        actions={<Button size="lg" onClick={() => notify("Sincronização simulada: nenhuma conexão real foi feita e nada mudou.")}>Sincronizar (simulado)</Button>}
      />
      <OwnerNotice owner={owner} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Estado" description="Valores de demonstração."><Dl items={[{ label: "Status", value: healthLabel[s.health] }, { label: "Atualização", value: s.freshness }, { label: "Registros", value: s.records.toLocaleString("pt-BR") }, { label: "Tipo", value: s.type }]} /></Panel>
        <Panel title="Conhecimento extraído">
          {knowledge.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum fato extraído desta fonte.</p> : <ul className="space-y-2 text-sm">{knowledge.map((k) => (<li key={k.id}><Link className="hover:underline" href={`/knowledge/${k.id}`}>{k.title}</Link></li>))}</ul>}
        </Panel>
        <Panel title="Oportunidades que dependem dela">
          {opportunities.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma oportunidade depende desta fonte.</p> : <ul className="space-y-2 text-sm">{opportunities.map((o) => (<li key={o.id}><Link className="hover:underline" href={`/opportunities/${o.id}`}>{o.title}</Link></li>))}</ul>}
        </Panel>
      </div>
    </div>
  );
}
