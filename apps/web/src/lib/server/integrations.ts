import "server-only";
import { unstable_rethrow } from "next/navigation";
import { countCities, engine, listImportRuns } from "@plataforma/api";
import { requestIdentity } from "./identity";
import { logServerError } from "./log";
import { isNotMigrated, loadForTenant, type Loaded } from "./tenant-data";

// Status das integrações, SEM expor segredos: só nomes de variáveis e se estão definidas. "Presente" não é "operacional": só vira operacional o que uma
// sondagem REAL feita agora confirmou (sessão verificada, banco respondeu). Fontes sem credencial ou autorização aparecem como bloqueadas, com a dependência exata.
export type IntegrationStatus = "operational" | "configured_unverified" | "not_configured" | "blocked_external" | "error";
export type IntegrationCategory = "Plataforma" | "Fonte de dados" | "Publicação e medição";
export interface IntegrationEntry {
  id: string; name: string; category: IntegrationCategory; status: IntegrationStatus;
  /** O que foi observado (sem valores de configuração). */
  detail: string;
  /** Variáveis de ambiente exigidas (nomes) e se estão definidas. */
  env: readonly { name: string; set: boolean }[];
  /** O que falta, exatamente, para destravar. */
  dependency: string | null;
}

export interface ProbeInput {
  env: Readonly<Record<string, string | undefined>>;
  /** Resultado da sondagem da sessão: `ok` (token verificado), `unauthenticated`, `not_configured` ou `error`. */
  identity: "ok" | "unauthenticated" | "not_configured" | "error";
  /** Resultado da leitura do banco pelo tenant da sessão. */
  database: Loaded<{ cities: number; realRuns: number; lastRealRun: "succeeded" | "partial" | "failed" | "running" | null; /** Última execução de pesquisa em que cada fonte foi consultada (ausente = nunca consultada). */ research?: readonly { adapter: string; status: string; at: Date }[] }>;
}

const isSet = (env: ProbeInput["env"], name: string) => (env[name] ?? "").trim() !== "";
const vars = (env: ProbeInput["env"], names: readonly string[]) => names.map((name) => ({ name, set: isSet(env, name) }));

export function buildIntegrations({ env, identity, database }: ProbeInput): IntegrationEntry[] {
  const authVars = vars(env, ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
  const dbVars = vars(env, ["PLATAFORMA_APP_DATABASE_URL"]);
  const authSet = authVars.every((v) => v.set);
  const base = { id: "supabase-auth", name: "Login (Supabase Auth)", category: "Plataforma" as const, env: authVars };
  let auth: IntegrationEntry;
  if (!authSet) auth = { ...base, status: "not_configured", detail: "Faltam variáveis do login; sem elas as telas reais não identificam o usuário.", dependency: "Definir as variáveis acima no servidor." };
  else if (identity === "ok") auth = { ...base, status: "operational", detail: "Sessão do usuário atual verificada agora (assinatura, emissor e validade).", dependency: null };
  else if (identity === "error") auth = { ...base, status: "error", detail: "Falha inesperada ao verificar a sessão agora.", dependency: null };
  else auth = { ...base, status: "configured_unverified", detail: "Variáveis definidas; nenhuma sessão válida foi verificada nesta requisição.", dependency: null };

  let db: IntegrationEntry;
  if (database.state === "ready") {
    db = { id: "app-database", name: "Banco de dados da aplicação", category: "Plataforma", env: dbVars, status: "operational", dependency: null,
      detail: `Banco respondeu agora (${database.origin?.kind === "local" ? "local, ambiente de desenvolvimento" : "remoto"}); ${database.data.cities.toLocaleString("pt-BR")} cidade(s) neste workspace.` };
  } else if (database.state === "not_configured") {
    db = { id: "app-database", name: "Banco de dados da aplicação", category: "Plataforma", env: dbVars, status: "not_configured", detail: "Banco ou login não configurados neste ambiente.", dependency: "Definir PLATAFORMA_APP_DATABASE_URL (papel menlo_app) no servidor." };
  } else if (database.state === "not_migrated") {
    db = { id: "app-database", name: "Banco de dados da aplicação", category: "Plataforma", env: dbVars, status: "configured_unverified", detail: "O banco respondeu, mas as tabelas esperadas não existem.", dependency: "Aplicar as migrations pendentes (exige autorização)." };
  } else if (database.state === "unauthenticated" || database.state === "no_tenant") {
    db = { id: "app-database", name: "Banco de dados da aplicação", category: "Plataforma", env: dbVars, status: "configured_unverified", detail: database.state === "no_tenant" ? "Usuário sem workspace associado: o banco não pôde ser consultado." : "Sem sessão: o banco não foi consultado.", dependency: null };
  } else {
    db = { id: "app-database", name: "Banco de dados da aplicação", category: "Plataforma", env: dbVars, status: "error", detail: database.state === "db_unavailable" ? "O banco não respondeu agora." : database.state === "auth_unavailable" ? "Falha ao verificar a sessão antes de consultar o banco." : "Falha ao consultar o banco.", dependency: null };
  }

  const ibge: IntegrationEntry = database.state === "ready" && database.data.realRuns > 0 && database.data.lastRealRun === "succeeded"
    ? { id: "ibge-cities", name: "Cidades do IBGE (importação por arquivo)", category: "Fonte de dados", env: [], status: "operational", dependency: null, detail: `${database.data.realRuns} importação(ões) real(is); a mais recente foi concluída. A importação ainda é feita por linha de comando.` }
    : { id: "ibge-cities", name: "Cidades do IBGE (importação por arquivo)", category: "Fonte de dados", env: [], status: database.state === "ready" ? "not_configured" : "configured_unverified", dependency: "Importar o arquivo de municípios do IBGE (CSV) para o workspace.", detail: database.state === "ready" ? "Nenhuma importação real concluída neste workspace." : "Não verificado: o banco não foi consultado." };

  const SOURCES = [
    { id: "bcb-sgs", name: "Banco Central do Brasil (SGS): juros e inflação", what: "séries Selic, IPCA e IGP-M" },
    { id: "ibge-news", name: "Notícias do IBGE (API pública)", what: "notícias filtradas pela vertical" },
    { id: "rss-news", name: "Agência Brasil (RSS público)", what: "feed de economia, respeitando robots.txt" },
  ] as const;
  const research: IntegrationEntry[] = SOURCES.map((src) => {
    const last = database.state === "ready" ? database.data.research?.find((r) => r.adapter === src.id) : undefined;
    const base = { id: src.id, name: src.name, category: "Fonte de dados" as const, env: [] as { name: string; set: boolean }[] };
    if (database.state !== "ready") return { ...base, status: "configured_unverified" as const, detail: "Não verificado: o banco não foi consultado.", dependency: null };
    if (!last) return { ...base, status: "not_configured" as const, detail: `Sem credencial (fonte pública). Nenhuma pesquisa consultou esta fonte neste workspace ainda (${src.what}).`, dependency: "Iniciar uma pesquisa em Oportunidades." };
    if (last.status === "succeeded") return { ...base, status: "operational" as const, detail: `Consultada com sucesso na última pesquisa (${src.what}), em ${last.at.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`, dependency: null };
    return { ...base, status: "error" as const, detail: `Na última pesquisa a fonte respondeu com resultado “${last.status === "partial" ? "parcial" : last.status === "skipped" ? "ignorada" : "falha"}”. Veja os detalhes em Tendências e notícias.`, dependency: null };
  });

  const blocked = (id: string, name: string, category: IntegrationCategory, detail: string, dependency: string): IntegrationEntry => ({ id, name, category, env: [], status: "blocked_external", detail, dependency });
  return [
    auth, db, ibge, ...research,
    blocked("search-trends", "Google Trends e provedores de tendência", "Fonte de dados", "Nenhum provedor autorizado nem credencial. Demanda de busca segue desconhecida nas oportunidades.", "Escolher e autorizar um provedor (contrato e credencial do dono)."),
    blocked("serp-provider", "Provedor de SERP e AI Overviews", "Fonte de dados", "Nenhum provedor de SERP contratado. Nenhuma posição, concorrente ou citação foi inventado.", "Contratar um provedor de SERP e registrar a credencial no servidor."),
    blocked("search-console", "Google Search Console", "Fonte de dados", "Nenhuma variável, credencial ou tabela de Search Console existe neste projeto. Existe só um extrator Python legado, fora do pipeline.", "OAuth do dono da propriedade com permissão completa; aprovação da lista de marca pela RE/MAX; aprovação do ADR-016; migrations das tabelas de busca e de um papel de carga (exigem autorização)."),
    blocked("ga4", "Google Analytics 4", "Fonte de dados", "Nenhuma configuração ou código de GA4 neste projeto.", "Propriedade GA4 e acesso autorizado."),
    blocked("property-feed", "Inventário de imóveis (RE/MAX)", "Fonte de dados", "Nenhuma fonte de imóveis foi apresentada. Nada de imóvel foi criado ou simulado; cidades do IBGE não substituem o inventário.", "Fonte real e autorizada (arquivo, feed ou API) com uma amostra da estrutura, termos de uso e política de dados pessoais."),
    blocked("publication", "Publicação de páginas", "Publicação e medição", "Não existe mecanismo de publicação: o banco só aceita os estados rascunho e bloqueada.", "Decisão do dono sobre o site e o mecanismo de publicação, mais a saúde do índice do domínio de pelo menos 95%."),
    blocked("ai-citations", "Citações e visibilidade em IA", "Publicação e medição", "Nenhuma fonte de medição definida.", "Fonte de medição autorizada."),
  ];
}

export async function loadIntegrations(): Promise<IntegrationEntry[]> {
  let identity: ProbeInput["identity"] = "error";
  try {
    const who = await requestIdentity();
    identity = who.state === "ok" ? "ok" : who.state;
  } catch (e) {
    unstable_rethrow(e);
    logServerError("integrations-identity", e);
  }
  const database = await loadForTenant(async (db) => {
    const cities = await countCities(db);
    const runs = await listImportRuns(db, { limit: 50 });
    const real = runs.filter((r) => r.origin === "real");
    // Última pesquisa em que cada fonte foi consultada; tabela ausente (migration 0008 pendente) só desliga esta parte.
    let research: { adapter: string; status: string; at: Date }[] | undefined;
    try {
      research = [];
      for (const r of await engine.listResearchRuns(db, 20)) for (const a of r.adapters as unknown as { adapter: string; status: string }[]) if (!research.some((x) => x.adapter === a.adapter)) research.push({ adapter: a.adapter, status: a.status, at: r.startedAt });
    } catch (e) { if (!isNotMigrated(e)) throw e; research = undefined; }
    return { cities, realRuns: real.length, lastRealRun: real[0]?.status ?? null, research };
  });
  return buildIntegrations({ env: process.env, identity, database });
}
