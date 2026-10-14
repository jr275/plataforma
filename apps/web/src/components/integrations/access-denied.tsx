import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Panel } from "@/components/ui/panel";

const COPY = {
  unauthenticated: { title: "Entre para ver as integrações", hint: "O estado das conexões e a identidade usada no Google só aparecem para uma sessão verificada." },
  no_tenant: { title: "Usuário sem workspace", hint: "Peça a um administrador para associar seu usuário a um workspace." },
  login_not_configured: { title: "Login não configurado", hint: "Em produção, as integrações exigem login. Configure a autenticação do ambiente." },
} as const;

export function IntegrationAccessDenied({ reason }: { reason: keyof typeof COPY }) {
  const c = COPY[reason];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader crumbs={[{ label: "Workspace" }, { label: "Integrações" }]} title="Integrações" />
      <Panel title="Acesso">
        <EmptyState title={c.title} hint={c.hint} />
      </Panel>
    </div>
  );
}
