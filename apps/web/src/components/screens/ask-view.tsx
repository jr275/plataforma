"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Send, Trash2 } from "lucide-react";
import { useAppState } from "@/components/app-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { demoAnswer, suggestions } from "@/lib/ask";
import { newId } from "@/lib/ids";
import { cn } from "@/lib/utils";

export function AskView() {
  const { current, chat, addMessages, clearChat, notify } = useAppState();
  const preset = useSearchParams().get("q") ?? "";
  const [textState, setTextState] = useState({ param: preset, text: preset });
  let text = textState.text;
  if (textState.param !== preset) {
    setTextState({ param: preset, text: preset });
    text = preset;
  }
  const setText = (v: string) => setTextState({ param: preset, text: v });
  const [error, setError] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [chat.length, thinking]);

  const send = (raw: string) => {
    const message = raw.trim();
    if (!message) {
      setError("Escreva uma pergunta antes de enviar.");
      return;
    }
    if (thinking) return;
    setError("");
    setText("");
    const wsId = current.workspace.id;
    addMessages(wsId, [{ id: newId("u"), role: "user", text: message }]);
    setThinking(true);
    // Atraso curto só para a interação parecer uma conversa; a resposta é calculada localmente e é sempre a mesma.
    timer.current = setTimeout(() => {
      const a = demoAnswer(message, current);
      addMessages(wsId, [{ id: newId("a"), role: "assistant", text: a.text, refs: a.refs }]);
      setThinking(false);
    }, 500);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Ask AI" }]}
        title="Ask AI"
        description={`Pergunte sobre os dados de demonstração de ${current.workspace.name}.`}
        badges={<Badge tone="warning">Protótipo: sem provedor de IA conectado</Badge>}
        actions={chat.length > 0 ? <Button variant="outline" onClick={() => { clearChat(current.workspace.id); notify("Conversa limpa."); }}><Trash2 data-icon="inline-start" aria-hidden="true" />Limpar conversa</Button> : undefined}
      />
      <div className="flex min-h-[28rem] flex-col card-cut">
        <div className="flex-1 space-y-4 overflow-y-auto p-4" role="log" aria-live="polite" aria-label="Conversa">
          {chat.length === 0 && !thinking ? (
            <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm font-medium">Comece por uma pergunta</p>
              <p className="text-xs text-muted-foreground">As respostas são determinísticas e montadas a partir dos registros fictícios deste workspace. Nenhum agente ou modelo real é chamado.</p>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestions(current).map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{s}</button>
                ))}
              </div>
            </div>
          ) : null}
          {chat.map((m) => (
            <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm", m.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-background")}>
                {m.role === "assistant" ? <p className="mb-1 text-[11px] font-medium text-warning">Resposta de demonstração</p> : null}
                <p>{m.text}</p>
                {m.refs && m.refs.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs">
                    {m.refs.map((r) => (
                      <li key={`${r.href}-${r.label}`}><Link href={r.href} className="text-brand hover:underline">{r.label}</Link></li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ))}
          {thinking ? <p className="text-xs text-muted-foreground" role="status">Montando a resposta de demonstração…</p> : null}
          <div ref={endRef} />
        </div>
        <form
          className="border-t border-border p-3"
          onSubmit={(e) => { e.preventDefault(); send(text); }}
          noValidate
        >
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Sua pergunta</span>
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); if (error) setError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }}
                rows={2}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "ask-error" : undefined}
                placeholder="Ex.: Quais oportunidades pedem decisão?"
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive"
              />
            </label>
            <Button type="submit" size="lg" disabled={thinking}><Send data-icon="inline-start" aria-hidden="true" />Enviar</Button>
          </div>
          {error ? <p id="ask-error" role="alert" className="mt-1.5 text-xs text-destructive">{error}</p> : <p className="mt-1.5 text-xs text-muted-foreground">Enter envia; Shift+Enter quebra a linha. Conversa guardada só neste navegador.</p>}
        </form>
      </div>
    </div>
  );
}
