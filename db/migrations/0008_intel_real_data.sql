-- 0008_intel_real_data: persistência da Unidade 3 (dados reais). Sinais com proveniência, score versionado, SERP, concorrência,
-- blueprint no servidor (substitui o rascunho do navegador), histórico do ciclo de vida e log de chamadas a provedores.
-- Toda tabela tem RLS forçada por tenant. "published"/"indexed" são recusados também no banco (defesa em profundidade).
-- NÃO APLICADA: aguarda destino comprovado (branch Neon dev-opportunity-engine) e `pnpm test:migrations` em banco descartável.

ALTER TABLE plataforma.opportunity
  ADD COLUMN query         text CHECK (query IS NULL OR length(query) BETWEEN 1 AND 300),
  ADD COLUMN cluster_key   text CHECK (cluster_key IS NULL OR length(cluster_key) <= 300),
  ADD COLUMN buyer_stage   text CHECK (buyer_stage IS NULL OR buyer_stage IN ('awareness', 'consideration', 'decision')),
  ADD COLUMN jtbd          text CHECK (jtbd IS NULL OR length(jtbd) <= 500),
  ADD COLUMN ibge_code     text CHECK (ibge_code IS NULL OR ibge_code ~ '^[0-9]{7}$'),
  ADD COLUMN stage         text NOT NULL DEFAULT 'discovered' CHECK (stage IN (
    'discovered', 'validated', 'scored', 'eligible', 'serp_collected', 'blueprinted', 'gate_approved', 'draft_generated', 'rejected')),
  ADD COLUMN data_mode     text NOT NULL DEFAULT 'real' CHECK (data_mode IN ('real', 'demo'));

CREATE UNIQUE INDEX opportunity_tenant_query_uidx ON plataforma.opportunity (tenant_id, lower(query)) WHERE query IS NOT NULL;

CREATE TABLE plataforma.provider_call_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES plataforma.tenant (id),
  run_id       uuid,
  provider     text        NOT NULL CHECK (provider IN ('dataforseo', 'gsc')),
  endpoint     text        NOT NULL CHECK (length(endpoint) BETWEEN 1 AND 300),
  cache_key    text        NOT NULL CHECK (length(cache_key) BETWEEN 1 AND 200),
  cache_hit    boolean     NOT NULL,
  ok           boolean     NOT NULL,
  cost_usd     numeric(10,4) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  response     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX provider_call_log_cache_idx ON plataforma.provider_call_log (tenant_id, cache_key) WHERE ok AND NOT cache_hit;

CREATE TABLE plataforma.opportunity_signal (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id uuid        NOT NULL,
  factor         text        NOT NULL CHECK (factor IN ('demand', 'competition', 'authority_gap', 'trend', 'cannibalization_risk', 'business_fit')),
  value          numeric     CHECK (value IS NULL OR (value >= 0 AND value <= 1)),
  raw_value      numeric,
  confidence     numeric     NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  origin         text        NOT NULL CHECK (origin IN ('measured', 'derived', 'estimated', 'demo', 'unavailable', 'not_evaluated')),
  provider       text        CHECK (provider IS NULL OR provider IN ('dataforseo', 'gsc', 'llm')),
  endpoint       text,
  params         jsonb       NOT NULL DEFAULT '{}',
  collected_at   timestamptz,
  call_log_id    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, call_log_id) REFERENCES plataforma.provider_call_log (tenant_id, id),
  -- "medido" exige proveniência completa (regra 3.1); sem valor não pode ser "medido" (regra 3.3).
  CHECK (origin <> 'measured' OR (value IS NOT NULL AND provider IS NOT NULL AND endpoint IS NOT NULL AND collected_at IS NOT NULL))
);
CREATE INDEX opportunity_signal_opp_idx ON plataforma.opportunity_signal (tenant_id, opportunity_id, factor, created_at DESC);

CREATE TABLE plataforma.opportunity_score (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id uuid        NOT NULL,
  config_version text        NOT NULL CHECK (config_version ~ '^[a-z_]+\.v[0-9]+$'),
  total          numeric     CHECK (total IS NULL OR (total >= 0 AND total <= 100)),
  confidence     numeric     NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  contributions  jsonb       NOT NULL,
  explanation    text[]      NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.opportunity (tenant_id, id)
);
CREATE INDEX opportunity_score_opp_idx ON plataforma.opportunity_score (tenant_id, opportunity_id, created_at DESC);

CREATE TABLE plataforma.serp_snapshot (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id uuid        NOT NULL,
  query          text        NOT NULL,
  location_code  integer     NOT NULL,
  language_code  text        NOT NULL,
  serp_features  text[]      NOT NULL DEFAULT '{}',
  people_also_ask text[]     NOT NULL DEFAULT '{}',
  collected_at   timestamptz NOT NULL,
  call_log_id    uuid,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, call_log_id) REFERENCES plataforma.provider_call_log (tenant_id, id)
);

CREATE TABLE plataforma.competitor (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL REFERENCES plataforma.tenant (id),
  domain     text        NOT NULL CHECK (domain ~ '^[a-z0-9.-]{1,253}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, domain)
);

CREATE TABLE plataforma.serp_result (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid    NOT NULL REFERENCES plataforma.tenant (id),
  snapshot_id   uuid    NOT NULL,
  competitor_id uuid,
  position      integer NOT NULL CHECK (position BETWEEN 1 AND 100),
  url           text    NOT NULL,
  domain        text    NOT NULL,
  result_type   text    NOT NULL,
  title         text,
  FOREIGN KEY (tenant_id, snapshot_id) REFERENCES plataforma.serp_snapshot (tenant_id, id),
  FOREIGN KEY (tenant_id, competitor_id) REFERENCES plataforma.competitor (tenant_id, id),
  UNIQUE (tenant_id, snapshot_id, position, result_type)
);
CREATE INDEX serp_result_competitor_idx ON plataforma.serp_result (tenant_id, competitor_id);

CREATE TABLE plataforma.page_blueprint (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id uuid        NOT NULL,
  version        integer     NOT NULL CHECK (version >= 1),
  content        jsonb       NOT NULL,
  content_hash   text        NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  gate_results   jsonb,
  gate_hash      text        CHECK (gate_hash IS NULL OR gate_hash ~ '^[0-9a-f]{64}$'),
  gate_approved  boolean     NOT NULL DEFAULT false,
  created_by     text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.opportunity (tenant_id, id),
  UNIQUE (tenant_id, opportunity_id, version),
  -- Aprovação só vale para o hash avaliado: uma versão alterada nunca herda aprovação (9.4).
  CHECK (NOT gate_approved OR (gate_hash IS NOT NULL AND gate_hash = content_hash AND gate_results IS NOT NULL))
);

CREATE TABLE plataforma.opportunity_transition (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id uuid        NOT NULL,
  from_stage     text        NOT NULL,
  to_stage       text        NOT NULL CHECK (to_stage NOT IN ('published', 'indexed')),
  actor          text        NOT NULL CHECK (length(actor) BETWEEN 1 AND 200),
  reason         text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.opportunity (tenant_id, id)
);
CREATE INDEX opportunity_transition_opp_idx ON plataforma.opportunity_transition (tenant_id, opportunity_id, created_at);

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['provider_call_log', 'opportunity_signal', 'opportunity_score', 'serp_snapshot', 'competitor',
                           'serp_result', 'page_blueprint', 'opportunity_transition'] LOOP
    EXECUTE format('ALTER TABLE plataforma.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE plataforma.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON plataforma.%I AS PERMISSIVE FOR ALL TO menlo_app '
                   'USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id())', t);
    EXECUTE format('REVOKE ALL ON TABLE plataforma.%I FROM PUBLIC', t);
  END LOOP;
END
$rls$;

-- Sem DELETE nem UPDATE onde o registro é histórico (sinais, scores, SERP, transições, log): apenas inserção.
GRANT SELECT, INSERT ON TABLE plataforma.provider_call_log, plataforma.opportunity_signal, plataforma.opportunity_score,
  plataforma.serp_snapshot, plataforma.serp_result, plataforma.opportunity_transition, plataforma.page_blueprint TO menlo_app;
GRANT SELECT, INSERT, UPDATE ON TABLE plataforma.competitor TO menlo_app;
