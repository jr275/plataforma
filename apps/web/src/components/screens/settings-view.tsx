"use client";

import { useState } from "react";
import { useAppState, type Prefs } from "@/components/app-state";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";

export function SettingsView() {
  const { prefs, setPrefs, workspaces, resetDemo, notify } = useAppState();
  const [draft, setDraft] = useState<Prefs>(prefs);
  const [saved, setSaved] = useState(prefs);
  const [error, setError] = useState("");
  const [reset, setReset] = useState(false);
  // Se as preferências mudarem por outro caminho (por exemplo, o botão da barra superior), o formulário acompanha.
  if (saved !== prefs) {
    setSaved(prefs);
    setDraft(prefs);
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const name = draft.displayName.trim();
    if (!name) { setError("Informe um nome de exibição."); return; }
    if (name.length > 60) { setError("Use no máximo 60 caracteres."); return; }
    setError("");
    setPrefs({ ...draft, displayName: name });
    notify("Preferências salvas neste navegador.");
  };

  return (
    <div className="space-y-6">
      <PageHeader crumbs={[{ label: "Settings" }]} title="Configurações" description="Preferências locais do protótipo. Ficam só neste navegador e não alteram nenhum tenant, banco ou serviço." />
      <form onSubmit={save} noValidate className="max-w-2xl space-y-4">
        <Panel title="Perfil de demonstração">
          <Field id="set-name" label="Nome de exibição" hint="Aparece no menu do usuário. Não há conta nem autenticação." error={error}>
            <input id="set-name" value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} aria-invalid={error ? true : undefined} aria-describedby={error ? "set-name-error" : undefined} className={inputClass} />
          </Field>
        </Panel>
        <Panel title="Workspace e interface">
          <div className="space-y-4">
            <Field id="set-ws" label="Workspace de demonstração padrão" hint="Aberto quando o navegador é recarregado em uma sessão nova.">
              <select id="set-ws" value={draft.defaultWorkspaceId} onChange={(e) => setDraft({ ...draft, defaultWorkspaceId: e.target.value })} className={inputClass}>
                {workspaces.map((w) => (<option key={w.workspace.id} value={w.workspace.id}>{w.workspace.name}</option>))}
              </select>
            </Field>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium">Tema</legend>
              <div className="flex gap-4 text-sm">
                {(["light", "dark"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-2"><input type="radio" name="theme" checked={draft.theme === t} onChange={() => setDraft({ ...draft, theme: t })} className="accent-[var(--brand)]" />{t === "light" ? "Claro" : "Escuro"}</label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium">Densidade das listas</legend>
              <div className="flex gap-4 text-sm">
                {(["comfortable", "compact"] as const).map((d) => (
                  <label key={d} className="flex items-center gap-2"><input type="radio" name="density" checked={draft.density === d} onChange={() => setDraft({ ...draft, density: d })} className="accent-[var(--brand)]" />{d === "comfortable" ? "Confortável" : "Compacta"}</label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.sidebarCollapsed} onChange={(e) => setDraft({ ...draft, sidebarCollapsed: e.target.checked })} className="size-4 accent-[var(--brand)]" />Iniciar com a barra lateral recolhida</label>
          </div>
        </Panel>
        <div className="flex gap-2">
          <Button type="submit" size="lg" disabled={!dirty}>Salvar preferências</Button>
          <Button type="button" variant="outline" size="lg" disabled={!dirty} onClick={() => { setDraft(prefs); setError(""); }}>Descartar alterações</Button>
        </div>
      </form>
      <Panel title="Dados de demonstração" description="Apaga estados, conversas, execuções e fontes simuladas deste navegador." className="max-w-2xl">
        <Button variant="outline" onClick={() => setReset(true)}>Redefinir dados de demonstração</Button>
      </Panel>
      <Modal open={reset} onOpenChange={setReset} title="Redefinir dados de demonstração?" description="As preferências são mantidas. Nada externo é afetado.">
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setReset(false)}>Cancelar</Button><Button onClick={() => { resetDemo(); setReset(false); notify("Dados de demonstração redefinidos."); }}>Redefinir</Button></div>
      </Modal>
    </div>
  );
}
