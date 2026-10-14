import "server-only";
import { unstable_rethrow } from "next/navigation";
import { countCities, engine, lastCallPerProvider, listImportRuns } from "@plataforma/api";
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
  database: Loaded<{ cities: number; realRuns: number; lastRealRun: "succeeded" | "partial" | "failed" | "running" | null; /** Última chamada registrada de cada provedor externo (ausente = nunca chamado; undefined = tabela ainda não existe). */ providers?: readonly { provider: string; outcome: "ok" | "provider_error"; errorCode: string | null; at: Date }[]; /** Última execução de pesquisa em que cada fonte foi consultada (ausente = nunca consultada). */ research?: readonly { adapter: string; status: string; at: Date }[] }>;
}

const isSet = (env: ProbeInput["env"], name: string) => (env[name] ?? "").trim() !== "";
const vars = (env: ProbeInput["env"], names: readonly string[]) => names.map((name) => ({ name, set: isSet(env, name) }));


const SIDRA_GDELT_OVERPASS = [
  { id: "ibge-sidra", name: "IBGE SIDRA (população e densidade)", what: "tabela 4714 do Censo 2022 por município", provider: "ibge-sidra" },
  { id: "gdelt", name: "GDELT (notícias complementares)", what: "artigos por termo, 1 requisição a cada 5 s", provider: "gdelt" },
  { id: "overpass", name: "OpenStreetMap (Overpass)", what: "contagem de equipamentos mapeados, só em jobs", provider: "overpass" },
] as const;

/** Provedor com credencial por variável de ambiente: o estado vem do que foi OBSERVADO (última chamada registrada), nunca só de a variável existir. */
function providerEntry(env: ProbeInput["env"], database: ProbeInput["database"], o: { id: string; name: string; provider: string; envNames: readonly string[]; what: string; dependency: string }): IntegrationEntry {
  const ev = vars(env, o.envNames);
  const base = { id: o.id, name: o.name, category: "Fonte de dados" as const, env: ev };
  const missing = ev.filter((v) => !v.set).map((v) => v.name);
  if (missing.length > 0) return { ...base, status: "not_configured", detail: `Variáveis ausentes: ${missing.join(", ")}. O adapter existe e está testado com fixtures; sem credencial nada é consultado (${o.what}).`, dependency: o.dependency };
  if (database.state !== "ready" || database.data.providers === undefined) return { ...base, status: "configured_unverified", detail: "Variáveis definidas. Não verificado: o registro de chamadas não pôde ser lido (migration 0011 ou banco indisponível).", dependency: null };
  const last = database.data.providers.find((x) => x.provider === o.provider);
  const when = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  if (!last) return { ...base, status: "configured_unverified", detail: `Variáveis definidas, mas nenhuma chamada foi registrada neste workspace: a credencial ainda não foi verificada (${o.what}).`, dependency: "Executar uma consulta de verificação autorizada (consome o teto de custo da unidade)." };
  if (last.outcome === "ok") return { ...base, status: "operational", detail: `Última chamada respondeu com sucesso em ${when(last.at)} (${o.what}).`, dependency: null };
  return { ...base, status: "error", detail: last.errorCode === "unauthorized" ? `A API recusou a credencial na última chamada (${when(last.at)}). Nenhum dado real foi obtido.` : `A última chamada falhou em ${when(last.at)} (${last.errorCode ?? "erro"}).`, dependency: last.errorCode === "unauthorized" ? "Corrigir a credencial no servidor e repetir a verificação." : null };
}

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
    providerEntry(env, database, { id: "dataforseo", name: "DataForSEO (volume, dificuldade, SERP, Trends, backlinks)", provider: "dataforseo", envNames: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"], what: "demanda, SERP, concorrentes e autoridade", dependency: "Definir as variáveis acima no servidor (senha de API da DataForSEO)." }),
    providerEntry(env, database, { id: "search-console", name: "Google Search Console (somente leitura)", provider: "google-search-console", envNames: ["GSC_CLIENT_EMAIL", "GSC_PRIVATE_KEY", "GSC_SITE_URL"], what: "canibalização e posição atual da propriedade", dependency: "Definir as variáveis acima (conta de serviço com acesso de leitura à propriedade)." }),
    providerEntry(env, database, { id: "anthropic-llm", name: "Classificação por LLM (Anthropic)", provider: "anthropic", envNames: ["ANTHROPIC_API_KEY"], what: "intenção, estágio, JTBD e tipo de página; nunca números", dependency: "Definir ANTHROPIC_API_KEY no servidor." }),
    ...SIDRA_GDELT_OVERPASS.map((src): IntegrationEntry => {
      const last = database.state === "ready" ? database.data.providers?.find((x) => x.provider === src.provider) : undefined;
      const base = { id: src.id, name: src.name, category: "Fonte de dados" as const, env: [] as { name: string; set: boolean }[] };
      if (database.state !== "ready" || database.data.providers === undefined) return { ...base, status: "configured_unverified", detail: "Fonte pública, sem credencial. Não verificado: o registro de chamadas não pôde ser lido.", dependency: null };
      if (!last) return { ...base, status: "not_configured", detail: `Fonte pública, sem credencial. Nenhuma chamada registrada neste workspace (${src.what}).`, dependency: "Executar o job que consulta esta fonte." };
      return last.outcome === "ok" ? { ...base, status: "operational", detail: `Última chamada respondeu com sucesso (${src.what}).`, dependency: null } : { ...base, status: "error", detail: `A última chamada falhou (${last.errorCode ?? "erro"}); fontes públicas podem limitar ou ficar indisponíveis.`, dependency: null };
    }),
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
    // Chamadas de provedores (migration 0011); tabela ausente só desliga esta parte.
    let providers: { provider: string; outcome: "ok" | "provider_error"; errorCode: string | null; at: Date }[] | undefined;
    try { providers = (await lastCallPerProvider(db)).map((c) => ({ provider: c.provider, outcome: c.outcome, errorCode: c.errorCode, at: c.at })); } catch (e) { if (!isNotMigrated(e)) throw e; providers = undefined; }
    return { cities, realRuns: real.length, lastRealRun: real[0]?.status ?? null, research, ...(providers ? { providers } : {}) };
  });
  return buildIntegrations({ env: process.env, identity, database });
}
