import { EmptyState, Panel } from "@/components/ui/panel";

export type BlockedState = "not_configured" | "unauthenticated" | "no_tenant" | "tenant_selection_required" | "not_migrated" | "error";

const COPY: Record<BlockedState, { title: string; hint: string }> = {
  not_configured: { title: "Esta área não está configurada neste ambiente", hint: "Faltam variáveis de ambiente do servidor. Nenhum dado de demonstração é exibido no lugar." },
  unauthenticated: { title: "Sessão não encontrada ou expirada", hint: "Entre novamente para ver os dados do seu workspace." },
  no_tenant: { title: "Seu usuário ainda não está associado a um workspace", hint: "O administrador precisa gravar a lista de tenants na claim assinada do seu usuário." },
  tenant_selection_required: { title: "Seleção de workspace necessária", hint: "Seu usuário tem acesso a mais de um workspace e a escolha explícita do workspace ainda não está disponível nesta versão. Nada é consultado em nome de um workspace escolhido por conveniência. Peça ao administrador para deixar um único workspace na sua claim assinada (ADR-015) ou aguarde a seleção." },
  not_migrated: { title: "As tabelas de geração ainda não existem neste banco", hint: "As migrations 0005, 0006 e 0007 ainda não foram aplicadas aqui. Até lá, esta área não tem dados reais para mostrar." },
  error: { title: "Não foi possível ler os dados agora", hint: "Houve uma falha ao consultar o banco. Tente novamente; se persistir, avise o administrador." },
};

/** Estado em que a tela não pode mostrar dados: explica o motivo em vez de simular conteúdo. */
export function StatePanel({ state, missing }: { state: BlockedState; missing?: string }) {
  const m = COPY[state];
  return (
    <Panel title="Estado">
      <EmptyState title={m.title} hint={state === "not_configured" && missing ? `${m.hint} (faltando: ${missing})` : m.hint} />
    </Panel>
  );
}
