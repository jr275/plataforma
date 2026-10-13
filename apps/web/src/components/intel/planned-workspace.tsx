import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { PageHeader, type Crumb } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StateNotice, TextLink } from "./primitives";

export type Dependency = { name: string; status: "missing" | "failing" | "partial"; detail: string };

/**
 * Área de trabalho ainda não implementada: diz o que ela fará, o que a impede hoje e o que já existe no dataset.
 * Não mostra números nem controles sem comportamento.
 */
export function PlannedWorkspace({
  crumbs,
  title,
  description,
  state,
  purpose,
  dependencies,
  related,
  children,
}: {
  crumbs: readonly Crumb[];
  title: string;
  description: string;
  state: "planned" | "blocked";
  purpose: readonly string[];
  dependencies: readonly Dependency[];
  related?: readonly { label: string; href: string }[];
  children?: ReactNode;
}) {
  const depTone = { missing: "outline", failing: "danger", partial: "warning" } as const;
  const depLabel = { missing: "Ausente", failing: "Com falha", partial: "Parcial" } as const;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader crumbs={crumbs} title={title} description={description} badges={<Badge tone={state === "blocked" ? "danger" : "info"}>{state === "blocked" ? "Bloqueado" : "Planejado"}</Badge>} />
      <StateNotice state={state} title={state === "blocked" ? "Esta área depende de uma integração que falhou ou não existe." : "Esta área ainda não está implementada no backend."}>
        Nenhum valor desta tela é exibido como medição. Quando as dependências abaixo forem conectadas, os dados passam a aparecer aqui com o rótulo “Conectado”.
      </StateNotice>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel title="O que esta área fará" className="lg:col-span-2">
          <ul className="flex flex-col gap-2 text-[13px] leading-relaxed">
            {purpose.map((p) => (
              <li key={p} className="flex gap-2"><span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-brand" />{p}</li>
            ))}
          </ul>
        </Panel>
        <Panel title="Dependências" description="O que precisa existir para a área funcionar." className="lg:col-span-3" bodyClassName="p-0">
          <ul>
            {dependencies.map((d) => (
              <li key={d.name} className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium">{d.name}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{d.detail}</p>
                </div>
                <Badge tone={depTone[d.status]}>{depLabel[d.status]}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      {children}
      {related?.length ? (
        <nav aria-label="Áreas relacionadas" className="flex flex-wrap gap-x-5 gap-y-2">
          {related.map((r) => <TextLink key={r.href} href={r.href}>{r.label} →</TextLink>)}
        </nav>
      ) : null}
    </div>
  );
}
