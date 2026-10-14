"use client";

import { useActionState, useState } from "react";
import { CheckCircle2, Circle, CircleDashed, Loader2, ShieldCheck, XCircle } from "lucide-react";
import type { GscCheck, GscCheckId, GscCheckState, GscStatus, GscValidationResult } from "@plataforma/api";
import { validateGscAction, type ValidateGscState } from "@/app/(app)/integrations/actions";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { labelClass } from "@/components/ui/frame";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import type { ProviderSummary } from "@/lib/server/gsc";
import { cn } from "@/lib/utils";

const STATUS: Record<GscStatus, { label: string; tone: Tone }> = {
  not_configured: { label: "Não configurado", tone: "neutral" },
  invalid_credentials: { label: "Credencial inválida", tone: "danger" },
  invalid_property: { label: "Propriedade inválida", tone: "danger" },
  api_not_enabled_or_unavailable: { label: "API indisponível", tone: "warning" },
  permission_denied: { label: "Permissão negada", tone: "danger" },
  provider_error: { label: "Erro do provedor", tone: "warning" },
  connected: { label: "Conectado", tone: "success" },
  connected_no_data: { label: "Conectado · sem dados", tone: "info" },
  validation_running: { label: "Validando…", tone: "brand" },
  configured_not_validated: { label: "Configurado · não validado", tone: "outline" },
};

const CHECK_LABEL: Record<GscCheckId, { title: string; group: string }> = {
  credentials_configured: { title: "Credencial definida", group: "Configuração" },
  credential_format: { title: "Formato da credencial", group: "Configuração" },
  authentication: { title: "Autenticação no Google", group: "Autenticação" },
  api_access: { title: "Search Console API acessível", group: "API" },
  property_access: { title: "Acesso à propriedade", group: "Propriedade" },
  search_analytics: { title: "Consulta de desempenho (7 dias)", group: "Search Analytics" },
};

const CHECK_STATE: Record<GscCheckState, { label: string; Icon: typeof Circle; className: string }> = {
  passed: { label: "passou", Icon: CheckCircle2, className: "text-success" },
  failed: { label: "falhou", Icon: XCircle, className: "text-destructive" },
  pending: { label: "pendente", Icon: CircleDashed, className: "text-muted-foreground" },
  not_checked: { label: "não verificado", Icon: Circle, className: "text-muted-foreground/50" },
};

const PROPERTY_KIND = { domain: "Propriedade de domínio", url_prefix: "Prefixo de URL" } as const;

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" }).format(new Date(iso)) + " UTC";
}

export function GscIntegrationView({ initial, providers, accessMode }: { initial: GscValidationResult; providers: readonly ProviderSummary[]; accessMode: "session" | "local_dev" }) {
  const [state, action, pending] = useActionState<ValidateGscState>(validateGscAction, null);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [seenResult, setSeenResult] = useState<ValidateGscState>(null);

  // Registra o último sucesso desta sessão quando chega um resultado novo (derivação durante o render, sem efeito).
  if (state !== seenResult) {
    setSeenResult(state);
    if (state?.kind === "result" && (state.result.status === "connected" || state.result.status === "connected_no_data")) setLastSuccessAt(state.result.finishedAt);
  }

  const result = state?.kind === "result" ? state.result : initial;
  const status: GscStatus = pending ? "validation_running" : result.status;
  const checks: readonly GscCheck[] = pending
    ? result.checks.map((c) => (c.id === "credentials_configured" || c.id === "credential_format" ? c : { ...c, state: "pending" as const, detail: "Em execução…" }))
    : result.checks;
  const live = result.mode === "live";
  const configBlocked = initial.error !== null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ label: "Workspace" }, { label: "Integrações" }]}
        title="Integrações"
        description="Conexões com provedores de dados de busca. Nenhum estado é afirmado sem uma verificação real."
        actions={
          <form action={action}>
            <Button type="submit" disabled={pending || configBlocked} aria-describedby={configBlocked ? "validate-hint" : undefined}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              {pending ? "Validando…" : "Validar conexão"}
            </Button>
          </form>
        }
      />
      {configBlocked ? (
        <p id="validate-hint" className="-mt-3 text-xs text-muted-foreground">A validação ao vivo fica disponível depois que a configuração local passar (etapas 1 e 2).</p>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {pending ? "Validando conexão com o Google Search Console." : state?.kind === "result" ? `Validação concluída: ${STATUS[result.status].label}.` : state?.kind === "denied" ? state.message : ""}
      </div>

      {state?.kind === "denied" ? (
        <p role="alert" className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{state.message}</p>
      ) : null}

      <section aria-labelledby="gsc-title" className="border border-border bg-card">
        <header className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center border border-border font-mono text-xs font-semibold">GSC</span>
            <div className="min-w-0">
              <h2 id="gsc-title" className="text-base font-semibold">Google Search Console</h2>
              <p className="text-xs text-muted-foreground">Desempenho orgânico observado: consultas, páginas, cliques, impressões e posição.</p>
            </div>
          </div>
          <Badge tone={STATUS[status].tone} className="self-start sm:self-center">{STATUS[status].label}</Badge>
        </header>

        <dl className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Identidade (service account)">
            {result.identity ? <span className="break-all font-mono text-xs">{result.identity.clientEmail}</span> : <Muted>Indisponível até a credencial ser válida</Muted>}
          </Field>
          <Field label="Projeto Google Cloud">
            {result.identity?.projectId ? <span className="font-mono text-xs">{result.identity.projectId}</span> : <Muted>—</Muted>}
          </Field>
          <Field label="Propriedade">
            {result.property ? (
              <div className="flex flex-col gap-1">
                <span className="break-all font-mono text-xs">{result.property.value}</span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="outline">{PROPERTY_KIND[result.property.kind]}</Badge>
                  <Badge tone={live && checks.find((c) => c.id === "property_access")?.state === "passed" ? "success" : "neutral"}>
                    {live && checks.find((c) => c.id === "property_access")?.state === "passed" ? "validada no Google" : "não validada"}
                  </Badge>
                </span>
              </div>
            ) : <Muted>Não definida ou inválida</Muted>}
          </Field>
          <Field label="Escopo">
            <span className="font-mono text-xs">webmasters.readonly</span>
            <Muted>Somente leitura</Muted>
          </Field>
          <Field label="Última tentativa">
            <span className="font-mono text-xs">{state ? formatDate(state.attemptedAt) : "—"}</span>
            {!state ? <Muted>Nenhuma validação nesta sessão</Muted> : null}
          </Field>
          <Field label="Último sucesso">
            <span className="font-mono text-xs">{formatDate(lastSuccessAt)}</span>
            <Muted>Nesta sessão; histórico ainda não é persistido</Muted>
          </Field>
          <Field label="Frescor dos dados">
            {live && result.dateRange ? (
              <>
                <span className="font-mono text-xs">{result.dateRange.startDate} → {result.dateRange.endDate}</span>
                <Muted>{result.rowsReturned ? `${result.rowsReturned} dia(s) com dados` : "Sem linhas no período"}</Muted>
              </>
            ) : <Muted>Desconhecido até validar</Muted>}
          </Field>
          <Field label="Duração">
            <span className="font-mono text-xs">{live ? `${result.durationMs} ms` : "—"}</span>
          </Field>
        </dl>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Panel title="Diagnóstico" description={live ? "Resultado da última validação ao vivo." : "Só a configuração local foi verificada. As etapas no Google ficam pendentes até validar."} className="lg:col-span-3" bodyClassName="p-0">
          <ol className="divide-y divide-border">
            {checks.map((c, i) => {
              const s = CHECK_STATE[c.state];
              const Icon = pending && c.state === "pending" ? Loader2 : s.Icon;
              return (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <span className={cn("mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums")}>{String(i + 1).padStart(2, "0")}</span>
                  <Icon className={cn("mt-0.5 size-4 shrink-0", s.className, pending && c.state === "pending" && "animate-spin")} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-sm font-medium">{CHECK_LABEL[c.id].title}</p>
                      <span className={cn(labelClass, "text-[10px]", s.className)}>{s.label}</span>
                    </div>
                    <p className={cn(labelClass, "mt-0.5 text-[10px] text-muted-foreground")}>{CHECK_LABEL[c.id].group}</p>
                    {c.detail ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.detail}</p> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </Panel>

        <div className="flex flex-col gap-6 lg:col-span-2">
          {result.remediation && !pending ? (
            <Panel title="Correção sugerida" description={result.explanation}>
              <dl className="flex flex-col gap-3 text-sm">
                <RemedyRow label="O que falhou">{result.remediation.what}</RemedyRow>
                <RemedyRow label="Por que importa">{result.remediation.why}</RemedyRow>
                <RemedyRow label="O que mudar">{result.remediation.change}</RemedyRow>
                <RemedyRow label="Onde">{result.remediation.where}</RemedyRow>
                <RemedyRow label="Quem">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {result.remediation.actor}
                    {result.remediation.external ? <Badge tone="warning">ação em console externo</Badge> : null}
                  </span>
                </RemedyRow>
                {result.error ? (
                  <RemedyRow label="Código">
                    <span className="font-mono text-xs">
                      {result.error.code}
                      {result.error.httpStatus ? ` · HTTP ${result.error.httpStatus}` : ""}
                      {result.error.upstreamReason ? ` · ${result.error.upstreamReason}` : ""}
                    </span>
                  </RemedyRow>
                ) : null}
              </dl>
              <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">Sugestão de diagnóstico. A plataforma não cria credenciais, não altera IAM e não habilita APIs.</p>
            </Panel>
          ) : (
            <Panel title="Resultado">
              <p className="text-sm leading-relaxed">{pending ? "Executando as etapas no Google, somente leitura." : result.explanation}</p>
            </Panel>
          )}

          <Panel title="Segurança">
            <ul className="flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground">
              <li>A chave privada, o JSON da credencial e o token de acesso ficam só no servidor e nunca são exibidos.</li>
              <li>Para trocar a credencial, atualize <span className="font-mono text-foreground">GSC_SERVICE_ACCOUNT_JSON_BASE64</span> em Settings → Vars.</li>
              <li>A validação é somente leitura e não grava dados de diagnóstico no banco.</li>
              {accessMode === "local_dev" ? <li className="text-warning">Ambiente sem login: acesso liberado só fora de produção.</li> : null}
            </ul>
          </Panel>

          <Panel title="Outros provedores" bodyClassName="p-0">
            <ul className="divide-y divide-border">
              {providers.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.configured ? "Variáveis definidas; conexão não validada nesta tela." : `Faltam: ${p.missing.join(", ")}`}</p>
                  </div>
                  <Badge tone={p.configured ? "outline" : "neutral"}>{p.configured ? "configurado" : "não configurado"}</Badge>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card px-4 py-3">
      <dt className={cn(labelClass, "text-[10px] text-muted-foreground")}>{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

function RemedyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className={cn(labelClass, "text-[10px] text-muted-foreground")}>{label}</dt>
      <dd className="leading-relaxed">{children}</dd>
    </div>
  );
}
