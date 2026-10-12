"use client";

import { useState } from "react";
import Link from "next/link";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import { slug } from "@/lib/slug";

type Preview = { template: string; pattern: string; items: { id: string; path: string; eligible: boolean; reason: string }[]; skipped: number };

export function ProgrammaticView() {
  const { current, notify } = useAppState();
  const [templateId, setTemplateId] = useState("");
  const [limit, setLimit] = useState("10");
  const [onlyVerified, setOnlyVerified] = useState(true);
  const [errors, setErrors] = useState<{ template?: string; limit?: string }>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const template = current.templates.find((t) => t.id === templateId) ?? null;

  const generate = (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!template) next.template = "Escolha um template.";
    const n = Number(limit);
    if (!limit.trim()) next.limit = "Informe o limite de páginas.";
    else if (!Number.isInteger(n) || n < 1 || n > 50) next.limit = "Use um número inteiro de 1 a 50.";
    setErrors(next);
    if (next.template || next.limit || !template) return;
    const matching = current.entities.filter((en) => en.type === template.entityType);
    const items = matching.map((en) => {
      const verified = current.knowledge.some((k) => k.entityIds.includes(en.id) && k.status === "verified");
      const placeholder = template.pattern.replace(/\{[^}]+\}/, slug(en.label));
      return { id: en.id, path: placeholder, eligible: verified || !onlyVerified, reason: verified ? "tem fato verificado" : "sem fato verificado" };
    });
    setPreview({ template: template.name, pattern: template.pattern, items: items.slice(0, n), skipped: Math.max(items.length - n, 0) });
    notify("Prévia gerada localmente. Nenhuma página foi criada.");
  };

  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Programmatic" }]} title="Geração programática" description={`Defina um template e veja, antes de qualquer coisa existir, quais páginas de ${current.workspace.name} ele geraria. Só prévia: nada é criado nem publicado.`} badges={<Badge tone="warning">Configuração de demonstração</Badge>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Panel title="Templates" description="Padrões de página por tipo de entidade.">
            <ul className="space-y-2">
              {current.templates.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => { setTemplateId(t.id); setPreview(null); setErrors({}); }} aria-pressed={templateId === t.id} className={`w-full rounded-lg border p-3 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${templateId === t.id ? "border-brand/40 bg-brand/10" : "border-border hover:bg-accent/50"}`}>
                    <span className="block font-medium">{t.name}</span>
                    <code className="block font-mono text-[11px] text-muted-foreground">{t.pattern}</code>
                    <span className="mt-1 block text-xs text-muted-foreground">{t.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Configuração da prévia">
            <form onSubmit={generate} noValidate className="space-y-4">
              <Field id="prog-template" label="Template" error={errors.template}>
                <select id="prog-template" value={templateId} onChange={(e) => { setTemplateId(e.target.value); setPreview(null); }} aria-invalid={errors.template ? true : undefined} aria-describedby={errors.template ? "prog-template-error" : undefined} className={inputClass}>
                  <option value="">Selecione…</option>
                  {current.templates.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
                </select>
              </Field>
              {template ? <p className="text-xs text-muted-foreground">Tipo de entidade: <strong>{template.entityType}</strong> · campos: {template.fields.join(", ")}</p> : null}
              <Field id="prog-limit" label="Limite de páginas" hint="Inteiro de 1 a 50." error={errors.limit}>
                <input id="prog-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={errors.limit ? true : undefined} aria-describedby={errors.limit ? "prog-limit-error" : undefined} className={inputClass} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={onlyVerified} onChange={(e) => setOnlyVerified(e.target.checked)} className="size-4 accent-[var(--brand)]" />
                Marcar como elegíveis só as entidades com fato verificado
              </label>
              <Button type="submit" size="lg">Gerar prévia</Button>
            </form>
          </Panel>
          <Panel title="Prévia" description="Caminhos que o template geraria (não criados)." bodyClassName="p-0">
            {!preview ? <EmptyState title="Nenhuma prévia ainda" hint="Escolha um template, informe o limite e gere a prévia." /> : preview.items.length === 0 ? <EmptyState title="Nenhuma entidade deste tipo" hint="O template não encontrou entidades do tipo configurado neste workspace." /> : (
              <>
                <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{preview.template} · <code className="font-mono">{preview.pattern}</code> · {preview.items.filter((i) => i.eligible).length} elegíveis de {preview.items.length}{preview.skipped ? ` (+${preview.skipped} acima do limite)` : ""}</p>
                <ul className="divide-y divide-border">
                  {preview.items.map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <code className="min-w-0 flex-1 truncate font-mono text-xs">{i.path}</code>
                      <Link href={`/entities/${i.id}`} className="text-xs text-muted-foreground hover:underline">entidade</Link>
                      <Badge tone={i.eligible ? "success" : "warning"}>{i.eligible ? "elegível" : "bloqueada"}</Badge>
                      <span className="hidden text-xs text-muted-foreground sm:inline">{i.reason}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
