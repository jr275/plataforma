import Link from "next/link";
import type { Opportunity, OpportunityIntent, OpportunityKind, OpportunityLevel, OpportunityStatus } from "@plataforma/api";
import { Badge, type Tone } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";
import type { Loaded } from "@/lib/server/tenant-data";

// Lista de oportunidades REAIS (tabela plataforma.opportunity). Fatores separados e nunca somados (regra 5, ADR-002): o modelo
// real não tem nota, então esta tela não mostra pontuação, "risco" nem "ciclo" (isso é da demonstração). `rank` é ordem editorial.

export const LEVEL_LABEL: Record<OpportunityLevel, string> = { high: "alta", medium: "média", low: "baixa" };
export const LEVEL_TONE: Record<OpportunityLevel, Tone> = { high: "brand", medium: "neutral", low: "outline" };
export const STATUS_LABEL: Record<OpportunityStatus, string> = { candidate: "Candidata", in_review: "Em revisão", ready: "Pronta para gates", blocked: "Bloqueada", dismissed: "Descartada" };
export const STATUS_TONE: Record<OpportunityStatus, Tone> = { candidate: "neutral", in_review: "info", ready: "success", blocked: "danger", dismissed: "outline" };
export const INTENT_LABEL: Record<OpportunityIntent, string> = { informational: "Informacional", comparison: "Comparação", transactional: "Transacional" };
export const KIND_LABEL: Record<OpportunityKind, string> = { page: "Página", cluster: "Cluster", faq: "FAQ", comparison: "Comparativo" };

export type BlockedState = "not_configured" | "unauthenticated" | "no_tenant" | "tenant_selection_required" | "not_migrated" | "error";

const COPY: Record<BlockedState, { title: string; hint: string }> = {
  not_configured: { title: "Esta área não está configurada neste ambiente", hint: "Faltam variáveis de ambiente do servidor. Nenhum dado de demonstração é exibido no lugar." },
  unauthenticated: { title: "Sessão não encontrada ou expirada", hint: "Entre novamente para ver as oportunidades do seu workspace." },
  no_tenant: { title: "Seu usuário ainda não está associado a um workspace", hint: "O administrador precisa gravar a lista de tenants na claim assinada do seu usuário." },
  tenant_selection_required: { title: "Seleção de workspace necessária", hint: "Seu usuário tem acesso a mais de um workspace e a escolha explícita ainda não está disponível nesta versão. Nada é consultado em nome de um workspace escolhido por conveniência. Peça ao administrador para deixar um único workspace na sua conta." },
  not_migrated: { title: "A tabela de oportunidades ainda não existe neste banco", hint: "As migrations 0001 e 0002 ainda não foram aplicadas aqui. Até lá, esta área não tem dados reais para mostrar." },
  error: { title: "Não foi possível ler as oportunidades agora", hint: "Houve uma falha ao consultar o banco. Tente novamente; se persistir, avise o administrador." },
};

/** Estado em que a tela não pode mostrar dados: explica o motivo em vez de simular conteúdo. */
export function OpportunityStatePanel({ state, missing }: { state: BlockedState; missing?: string }) {
  const m = COPY[state];
  return (
    <Panel title="Estado">
      <EmptyState title={m.title} hint={state === "not_configured" && missing ? `${m.hint} (faltando: ${missing})` : m.hint} />
    </Panel>
  );
}

function Header() {
  return (
    <PageHeader
      crumbs={[{ label: "Intelligence" }, { label: "Opportunity Discovery" }]}
      title="Opportunity Discovery"
      description="Oportunidades do seu workspace, na ordem editorial. Demanda, concorrência e evidência aparecem separadas: não há nota única."
      badges={<Badge tone="success">Dados reais</Badge>}
    />
  );
}

export function RealOpportunitiesView({ loaded }: { loaded: Loaded<readonly Opportunity[]> }) {
  if (loaded.state !== "ready") {
    return (
      <div className="space-y-6">
        <Header />
        <OpportunityStatePanel state={loaded.state} {...(loaded.state === "not_configured" ? { missing: loaded.missing } : {})} />
      </div>
    );
  }
  const rows = loaded.data;
  return (
    <div className="space-y-6">
      <Header />
      <Panel title="Oportunidades" description={`${rows.length} no workspace (descartadas ficam de fora).`}>
        {rows.length === 0 ? (
          <EmptyState title="Nenhuma oportunidade neste workspace ainda" hint="Elas aparecem aqui quando forem cadastradas. Esta tela não inventa dados para preencher o espaço." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Oportunidades do workspace, em ordem editorial</caption>
              <thead className="font-mono text-[10.5px] tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th scope="col" className="py-2 pr-4 text-right">Ordem</th>
                  <th scope="col" className="pr-4">Oportunidade</th>
                  <th scope="col" className="pr-4">Intenção</th>
                  <th scope="col" className="pr-4">Demanda</th>
                  <th scope="col" className="pr-4">Concorrência</th>
                  <th scope="col" className="pr-4">Evidência</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-t border-border align-top">
                    <td className="py-2 pr-4 text-right font-mono text-xs tabular-nums">{o.rank}</td>
                    <td className="py-2 pr-4">
                      <Link href={`/opportunities/${o.id}`} className="font-medium underline-offset-2 hover:underline focus-visible:underline">{o.title}</Link>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{KIND_LABEL[o.kind]}</span>
                    </td>
                    <td className="py-2 pr-4">{INTENT_LABEL[o.intent]}</td>
                    <td className="py-2 pr-4"><Badge tone={LEVEL_TONE[o.demand]}>{LEVEL_LABEL[o.demand]}</Badge></td>
                    <td className="py-2 pr-4"><Badge tone={LEVEL_TONE[o.competition]}>{LEVEL_LABEL[o.competition]}</Badge></td>
                    <td className="py-2 pr-4"><Badge tone={LEVEL_TONE[o.evidence]}>{LEVEL_LABEL[o.evidence]}</Badge></td>
                    <td className="py-2"><Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
