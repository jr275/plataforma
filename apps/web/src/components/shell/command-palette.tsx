"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { useAppState } from "@/components/app-state";
import { allNavItems } from "@/config/navigation";
import { cn } from "@/lib/utils";

type Command = { id: string; group: string; label: string; hint?: string; keywords: string; run: () => void };

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function CommandPalette() {
  const router = useRouter();
  const { paletteOpen, setPaletteOpen, current, workspaces, selectWorkspace, notify } = useAppState();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const close = () => {
    setPaletteOpen(false);
    setQuery("");
    setCursor(0);
  };

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href);
    const list: Command[] = [];
    for (const n of allNavItems) list.push({ id: `nav-${n.id}`, group: "Ir para", label: n.label, keywords: n.label, run: go(n.href) });
    for (const o of current.opportunities) list.push({ id: o.id, group: "Oportunidades", label: o.title, hint: o.kind, keywords: `${o.title} ${o.summary} ${o.intent}`, run: go(`/opportunities/${o.id}`) });
    for (const e of current.entities) list.push({ id: e.id, group: "Entidades", label: e.label, hint: e.type, keywords: `${e.label} ${e.type} ${e.summary}`, run: go(`/entities/${e.id}`) });
    for (const k of current.knowledge) list.push({ id: k.id, group: "Conhecimento", label: k.title, hint: "registro", keywords: `${k.title} ${k.statement}`, run: go(`/knowledge/${k.id}`) });
    for (const p of current.pages) list.push({ id: p.id, group: "Páginas", label: p.title, hint: p.path, keywords: `${p.title} ${p.path} ${p.summary}`, run: go(`/pages/${p.id}`) });
    for (const q of current.queries) list.push({ id: q.id, group: "Buscas", label: q.text, hint: q.cluster, keywords: `${q.text} ${q.cluster}`, run: go(`/search-universe?q=${encodeURIComponent(q.text)}`) });
    for (const a of current.agents) list.push({ id: a.id, group: "Agentes", label: a.name, hint: a.role, keywords: `${a.name} ${a.description}`, run: go(`/agents/${a.id}`) });
    for (const s of current.sources) list.push({ id: s.id, group: "Fontes de dados", label: s.name, hint: s.type, keywords: `${s.name} ${s.type} ${s.description}`, run: go(`/data-sources/${s.id}`) });
    for (const w of workspaces.filter((w) => w.workspace.id !== current.workspace.id)) {
      list.push({ id: `ws-${w.workspace.id}`, group: "Workspace", label: `Trocar para ${w.workspace.name}`, keywords: `workspace trocar ${w.workspace.name}`, run: () => { selectWorkspace(w.workspace.id); notify(`Workspace alterado para ${w.workspace.name}.`); } });
    }
    return list;
  }, [current, workspaces, router, selectWorkspace, notify]);

  const results = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return commands.slice(0, 60);
    return commands.filter((c) => norm(`${c.label} ${c.keywords}`).includes(q));
  }, [commands, query]);

  const index = Math.min(cursor, Math.max(results.length - 1, 0));
  const choose = (c: Command | undefined) => {
    if (!c) return;
    close();
    c.run();
  };

  return (
    <Dialog.Root open={paletteOpen} onOpenChange={(o) => (o ? setPaletteOpen(true) : close())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed top-[12vh] left-1/2 z-50 w-[min(40rem,calc(100vw-1.5rem))] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl shadow-black/50 outline-none transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
          <Dialog.Title className="sr-only">Busca e comandos</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 text-muted-foreground" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setCursor(Math.min(index + 1, results.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setCursor(Math.max(index - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); choose(results[index]); }
              }}
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={results[index] ? `cmd-${results[index].id}` : undefined}
              placeholder={`Buscar em ${current.workspace.name}…`}
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul id="palette-list" role="listbox" aria-label="Resultados" className="max-h-[50vh] overflow-y-auto p-1.5">
            {results.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-muted-foreground" role="presentation">
                Nada encontrado para “{query}” nos dados de demonstração.
              </li>
            ) : null}
            {results.map((c, i) => {
              const header = results[i - 1]?.group !== c.group;
              return (
                <li key={c.id} role="presentation">
                  {header ? <p className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{c.group}</p> : null}
                  <div
                    id={`cmd-${c.id}`}
                    role="option"
                    aria-selected={i === index}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => choose(c)}
                    className={cn("flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm", i === index && "bg-accent")}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {c.hint ? <span className="text-[11px] text-muted-foreground">{c.hint}</span> : null}
                    {i === index ? <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <span>↑↓ navegar</span>
            <span>↵ abrir</span>
            <span>esc fechar</span>
            <span className="ml-auto">Busca local em dados demonstrativos</span>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
