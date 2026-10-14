-- 0011_provider_data: dados de provedores externos (ADR-027). Cinco tabelas do tenant: cache bruto e custo das chamadas, sinais observados por fator,
-- instantâneos de SERP, resultados da SERP e concorrentes. O "grafo competitivo" é relacional (resultado → concorrente → instantâneo → query), sem banco de grafos.
-- Tudo é histórico imutável para a aplicação (SELECT/INSERT), exceto a classificação dos resultados da SERP, que é preenchida depois (UPDATE só nessas colunas).
-- Ausência de dado NÃO gera linha: um fator sem medição continua `unknown` no score; nada é gravado como zero.

CREATE TABLE plataforma.provider_call (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid          NOT NULL REFERENCES plataforma.tenant (id),
  run_id      uuid,
  provider    text          NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{1,40}$'),
  endpoint    text          NOT NULL CHECK (length(endpoint) BETWEEN 1 AND 300),
  params      jsonb         NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  -- chave determinística: sha256 de (provedor, endpoint, parâmetros canônicos); o cache só reutiliza respostas 'ok' ainda válidas
  cache_key   text          NOT NULL CHECK (cache_key ~ '^[0-9a-f]{64}$'),
  outcome     text          NOT NULL CHECK (outcome IN ('ok', 'provider_error')),
  http_status integer       CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  error_code  text          CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 80),
  cost_usd    numeric(12,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  response    jsonb         CHECK (response IS NULL OR jsonb_typeof(response) IN ('object', 'array')),
  collected_at timestamptz  NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  created_by  text          NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  FOREIGN KEY (tenant_id, run_id) REFERENCES plataforma.research_run (tenant_id, id),
  UNIQUE (tenant_id, id),
  CHECK ((outcome = 'ok') = (response IS NOT NULL)),
  CHECK ((outcome = 'provider_error') = (error_code IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at > collected_at)
);
CREATE INDEX provider_call_cache_idx ON plataforma.provider_call (tenant_id, cache_key, collected_at DESC) WHERE outcome = 'ok';
CREATE INDEX provider_call_run_idx ON plataforma.provider_call (tenant_id, run_id);
CREATE INDEX provider_call_spend_idx ON plataforma.provider_call (tenant_id, provider, collected_at);

CREATE TABLE plataforma.opportunity_signal (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid          NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id   uuid          NOT NULL,
  -- fator medido: uma dimensão do score (demand, competition, ...) ou um valor bruto (search_volume, cpc, keyword_difficulty, trend); validado em packages/api
  factor           text          NOT NULL CHECK (factor ~ '^[a-z][a-z0-9_]{1,40}$'),
  value            numeric(18,6) NOT NULL,
  unit             text          CHECK (unit IS NULL OR length(unit) BETWEEN 1 AND 30),
  basis            text          NOT NULL CHECK (basis IN ('observed', 'provider_metric', 'derived', 'inferred', 'estimated')),
  confidence       numeric(5,4)  NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  source           text          NOT NULL CHECK (length(source) BETWEEN 1 AND 120),
  collected_at     timestamptz   NOT NULL,
  expires_at       timestamptz,
  provider_call_id uuid,
  payload          jsonb         NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  note             text          CHECK (note IS NULL OR length(note) <= 500),
  created_at       timestamptz   NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, provider_call_id) REFERENCES plataforma.provider_call (tenant_id, id),
  UNIQUE (tenant_id, id),
  -- métrica de provedor sempre aponta para a resposta bruta que a originou
  CHECK (basis <> 'provider_metric' OR provider_call_id IS NOT NULL),
  CHECK (expires_at IS NULL OR expires_at > collected_at)
);
CREATE INDEX opportunity_signal_latest_idx ON plataforma.opportunity_signal (tenant_id, opportunity_id, factor, collected_at DESC);

CREATE TABLE plataforma.competitor (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES plataforma.tenant (id),
  domain     text        NOT NULL CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND length(domain) <= 253),
  label      text        CHECK (label IS NULL OR length(label) BETWEEN 1 AND 120),
  -- own: o domínio do tenant; declared: informado pelo dono; observed: apareceu em uma SERP coletada
  kind       text        NOT NULL CHECK (kind IN ('own', 'declared', 'observed')),
  created_by text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, domain)
);

CREATE TABLE plataforma.serp_snapshot (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id   uuid,
  provider_call_id uuid        NOT NULL,
  query            text        NOT NULL CHECK (length(query) BETWEEN 1 AND 300),
  country          text        NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  language         text        NOT NULL CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  location_code    integer,
  location_name    text        CHECK (location_name IS NULL OR length(location_name) <= 200),
  device           text        NOT NULL CHECK (device IN ('desktop', 'mobile')),
  captured_at      timestamptz NOT NULL,
  features         text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(features) <= 40),
  people_also_ask  jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(people_also_ask) = 'array'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, provider_call_id) REFERENCES plataforma.provider_call (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, provider_call_id)
);
CREATE INDEX serp_snapshot_query_idx ON plataforma.serp_snapshot (tenant_id, query, captured_at DESC);
CREATE INDEX serp_snapshot_opportunity_idx ON plataforma.serp_snapshot (tenant_id, opportunity_id, captured_at DESC);

CREATE TABLE plataforma.serp_result (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant (id),
  snapshot_id    uuid        NOT NULL,
  rank           integer     NOT NULL CHECK (rank BETWEEN 1 AND 100),
  result_type    text        NOT NULL CHECK (result_type IN ('organic', 'featured_snippet', 'local_pack', 'video', 'news', 'other')),
  url            text        NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 2000),
  domain         text        NOT NULL CHECK (length(domain) BETWEEN 3 AND 253),
  title          text        CHECK (title IS NULL OR length(title) <= 500),
  competitor_id  uuid,
  -- preenchidos depois da coleta (regra ou LLM com esquema validado); NULL = ainda não classificado, nunca "other" por padrão
  page_type      text        CHECK (page_type IS NULL OR page_type IN ('portal', 'listing', 'article', 'tool', 'map', 'forum', 'video', 'institutional', 'other')),
  classification jsonb       CHECK (classification IS NULL OR jsonb_typeof(classification) = 'object'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES plataforma.serp_snapshot (tenant_id, id),
  FOREIGN KEY (tenant_id, competitor_id) REFERENCES plataforma.competitor (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, snapshot_id, result_type, rank),
  CHECK ((page_type IS NULL) = (classification IS NULL))
);
CREATE INDEX serp_result_competitor_idx ON plataforma.serp_result (tenant_id, competitor_id, rank);
CREATE INDEX serp_result_domain_idx ON plataforma.serp_result (tenant_id, domain);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['provider_call', 'opportunity_signal', 'competitor', 'serp_snapshot', 'serp_result'] LOOP
    EXECUTE format('ALTER TABLE plataforma.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE plataforma.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON plataforma.%I AS PERMISSIVE FOR ALL TO menlo_app USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id())', t);
    EXECUTE format('REVOKE ALL ON TABLE plataforma.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE plataforma.%I TO menlo_app', t);
  END LOOP;
END $$;
-- única mutação permitida: classificar um resultado já coletado (nunca a URL, a posição nem o instantâneo)
GRANT UPDATE (page_type, classification, competitor_id) ON TABLE plataforma.serp_result TO menlo_app;
