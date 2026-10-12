-- Menlo OS: esquema base (PostgreSQL 14+; testado no 16)
-- Fonte da verdade do conhecimento. Multi-tenant, com mercado e idioma desde o início.
-- Extensões opcionais (PostGIS, pgvector) ficam em 02_extensoes_opcionais.sql.

CREATE EXTENSION IF NOT EXISTS btree_gist;   -- exclusão de validade sobreposta em relações
CREATE SCHEMA IF NOT EXISTS menlo;
SET search_path = menlo, public;

-- ---------------------------------------------------------------- BASE
CREATE TABLE tenant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  vertical    text NOT NULL DEFAULT 'real_estate',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE market (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  code             text NOT NULL,                 -- ex.: 'br', 'us-fl'
  country_code     char(2) NOT NULL,
  default_locale   text NOT NULL,                 -- BCP-47, ex.: 'pt-BR'
  currency         char(3),
  UNIQUE (tenant_id, code)
);

-- Fontes. 'independence_group' agrupa fontes que não são independentes entre si
-- (ex.: dois portais que republicam o mesmo feed contam como uma só para corroboração).
CREATE TABLE source (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  name               text NOT NULL,
  kind               text NOT NULL CHECK (kind IN
                       ('first_party_feed','public_dataset','third_party','competitor',
                        'search_console','analytics','crm','manual','model')),
  authority_class    text NOT NULL DEFAULT 'secondary'
                       CHECK (authority_class IN ('primary','secondary','tertiary')),
  independence_group text,
  base_url           text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- ---------------------------------------------------------------- ENTIDADES
CREATE TABLE entity_type (
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  code       text NOT NULL,                       -- 'city','neighborhood','property','agent',...
  label      text NOT NULL,
  PRIMARY KEY (tenant_id, code)
);

-- Contrato de conhecimento por tipo de entidade: o que precisa existir para ser publicável.
CREATE TABLE entity_type_schema (
  tenant_id          uuid NOT NULL,
  entity_type        text NOT NULL,
  attribute_key      text NOT NULL,
  requirement        text NOT NULL CHECK (requirement IN ('required','recommended','optional')),
  min_claim_class    text NOT NULL DEFAULT 'DERIVED'
                       CHECK (min_claim_class IN ('VERIFIED','DERIVED','INFERRED')),
  min_sources        int  NOT NULL DEFAULT 1 CHECK (min_sources >= 1),
  freshness_sla      interval,                    -- NULL = não expira
  PRIMARY KEY (tenant_id, entity_type, attribute_key),
  FOREIGN KEY (tenant_id, entity_type) REFERENCES entity_type(tenant_id, code)
);

CREATE TABLE entity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  entity_type   text NOT NULL,
  canonical_key text NOT NULL,                    -- ID estável (do feed ou gerado)
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','merged')),
  merged_into   uuid REFERENCES entity(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, entity_type) REFERENCES entity_type(tenant_id, code),
  UNIQUE (tenant_id, entity_type, canonical_key),
  CHECK ((status = 'merged') = (merged_into IS NOT NULL))
);
CREATE INDEX entity_type_idx ON entity (tenant_id, entity_type);

CREATE TABLE entity_alias (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  entity_id  uuid NOT NULL REFERENCES entity(id),
  alias      text NOT NULL,
  source_id  uuid REFERENCES source(id),
  UNIQUE (entity_id, alias)
);

-- ---------------------------------------------------------------- RELAÇÕES (com validade)
CREATE TABLE relation_type (
  tenant_id   uuid NOT NULL,
  code        text NOT NULL,                      -- 'located_in','near','belongs_to',...
  from_type   text NOT NULL,
  to_type     text NOT NULL,
  label       text NOT NULL,
  PRIMARY KEY (tenant_id, code),
  FOREIGN KEY (tenant_id, from_type) REFERENCES entity_type(tenant_id, code),
  FOREIGN KEY (tenant_id, to_type)   REFERENCES entity_type(tenant_id, code)
);

CREATE TABLE relation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  relation_type text NOT NULL,
  from_entity   uuid NOT NULL REFERENCES entity(id),
  to_entity     uuid NOT NULL REFERENCES entity(id),
  attributes    jsonb NOT NULL DEFAULT '{}',      -- ex.: {"distance_m": 450}
  claim_class   text NOT NULL CHECK (claim_class IN ('VERIFIED','DERIVED','INFERRED','UNSUPPORTED')),
  confidence    numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  source_id     uuid REFERENCES source(id),
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_to      timestamptz,                      -- NULL = em vigor
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, relation_type) REFERENCES relation_type(tenant_id, code),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK (from_entity <> to_entity),
  -- a mesma relação não pode estar em vigor duas vezes ao mesmo tempo
  EXCLUDE USING gist (
    tenant_id WITH =, relation_type WITH =, from_entity WITH =, to_entity WITH =,
    tstzrange(valid_from, valid_to) WITH &&
  )
);
CREATE INDEX relation_from_idx ON relation (from_entity, relation_type) WHERE valid_to IS NULL;
CREATE INDEX relation_to_idx   ON relation (to_entity,   relation_type) WHERE valid_to IS NULL;

-- ---------------------------------------------------------------- AFIRMAÇÕES E EVIDÊNCIA
-- Uma linha de claim é IMUTÁVEL (valor, fonte, classe). Mudar um fato = nova linha que
-- substitui a anterior (superseded_by). Assim a linhagem das páginas aponta para versões exatas.
CREATE TABLE claim (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  entity_id     uuid NOT NULL REFERENCES entity(id),
  attribute_key text NOT NULL,
  market_id     uuid REFERENCES market(id),       -- NULL = vale para todos os mercados
  value         jsonb NOT NULL,
  unit          text,
  claim_class   text NOT NULL CHECK (claim_class IN ('VERIFIED','DERIVED','INFERRED','UNSUPPORTED')),
  confidence    numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  source_id     uuid REFERENCES source(id),
  observed_at   timestamptz NOT NULL,
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_to      timestamptz,
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','superseded','conflicted','rejected')),
  superseded_by uuid REFERENCES claim(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK ((status = 'superseded') = (superseded_by IS NOT NULL))
);
CREATE INDEX claim_current_idx ON claim (entity_id, attribute_key) WHERE status IN ('active','conflicted');
CREATE INDEX claim_source_idx  ON claim (source_id);

CREATE FUNCTION claim_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.value IS DISTINCT FROM OLD.value
     OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
     OR NEW.attribute_key IS DISTINCT FROM OLD.attribute_key
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.claim_class IS DISTINCT FROM OLD.claim_class THEN
    RAISE EXCEPTION 'claim % é imutável: crie uma nova linha e use superseded_by', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER claim_immutable_trg BEFORE UPDATE ON claim
  FOR EACH ROW EXECUTE FUNCTION claim_immutable();

CREATE TABLE evidence (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  claim_id      uuid NOT NULL REFERENCES claim(id),
  source_id     uuid REFERENCES source(id),
  kind          text NOT NULL CHECK (kind IN ('observation','document','api','derivation','corroboration')),
  locator       text,                             -- URL, caminho do arquivo ou ID do registro
  excerpt       text,
  content_hash  text,
  observed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evidence_claim_idx ON evidence (claim_id);

-- Fontes que discordam sobre o mesmo atributo: registramos o conflito, não escolhemos em silêncio.
CREATE TABLE claim_conflict (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  entity_id     uuid NOT NULL REFERENCES entity(id),
  attribute_key text NOT NULL,
  claim_ids     uuid[] NOT NULL CHECK (cardinality(claim_ids) >= 2),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','accepted_risk')),
  resolution    text,
  resolved_claim_id uuid REFERENCES claim(id),
  opened_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

-- ---------------------------------------------------------------- DEMANDA E OPORTUNIDADES
CREATE TABLE demand_pattern (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  market_id     uuid NOT NULL REFERENCES market(id),
  pattern       text NOT NULL,                    -- ex.: '[tipo] para comprar em [bairro]'
  intent        text NOT NULL CHECK (intent IN
                  ('informational','navigational','commercial','transactional',
                   'comparison','local','decision_support','agent_mediated')),
  entity_type   text,
  metrics       jsonb NOT NULL DEFAULT '{}',      -- volume, tendência, cliques etc., sem nota única
  observed_period daterange,
  source_id     uuid REFERENCES source(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A unidade central: uma oportunidade de conhecimento e a ação decidida (inclusive "nenhuma").
-- Fatores ficam SEPARADOS em jsonb versionado; não há coluna de nota única.
CREATE TABLE opportunity (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  market_id         uuid NOT NULL REFERENCES market(id),
  locale            text NOT NULL,
  entity_id         uuid REFERENCES entity(id),
  demand_pattern_id uuid REFERENCES demand_pattern(id),
  intent            text,
  gap_types         text[] NOT NULL DEFAULT '{}'
                      CHECK (gap_types <@ ARRAY['entity','attribute','relationship','intent',
                             'evidence','authority','citation','freshness','conversion','competitive']),
  factors           jsonb NOT NULL DEFAULT '{}',  -- demand, business_value, coverage, evidence, info_gain,
                                                  -- competition, authority_gap, cannibalization_risk, asset_cost
  factors_version   text NOT NULL,
  priority_rank     int,                          -- posição segundo a regra de ordenação versionada
  action            text NOT NULL CHECK (action IN
                      ('create','update','consolidate','acquire_evidence','create_relation',
                       'authority_action','geo_surface','no_action')),
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','approved','executing','done','rejected','expired')),
  decision_reason   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz
);
CREATE INDEX opportunity_queue_idx ON opportunity (tenant_id, status, priority_rank);

-- ---------------------------------------------------------------- TEMPLATES E SUPERFÍCIES
CREATE TABLE template (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  code             text NOT NULL,
  version          int  NOT NULL,
  entity_type      text,
  contract         jsonb NOT NULL,                -- atributos/relações/evidência exigidos, seções opcionais
  rollout_stage    text NOT NULL DEFAULT 'draft'
                     CHECK (rollout_stage IN ('draft','canary','general','retired')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code, version)
);

CREATE TABLE surface (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  market_id        uuid NOT NULL REFERENCES market(id),
  locale           text NOT NULL,
  kind             text NOT NULL CHECK (kind IN
                     ('entity_page','location_page','comparison','faq','dataset','structured_data','geo_surface')),
  url_path         text NOT NULL,
  entity_id        uuid REFERENCES entity(id),
  opportunity_id   uuid REFERENCES opportunity(id),
  template_id      uuid REFERENCES template(id),
  -- estados do ciclo de vida; DRAFT e LIVE acrescentados para separar "decidido" de "publicado"
  state            text NOT NULL DEFAULT 'DRAFT' CHECK (state IN
                     ('CREATE','UPDATE','MERGE','WAIT','NOINDEX','REDIRECT','RETIRE','DO_NOT_CREATE','DRAFT','LIVE')),
  index_policy     text NOT NULL DEFAULT 'noindex' CHECK (index_policy IN ('index','noindex')),
  canonical_surface_id uuid REFERENCES surface(id),
  redirect_to      uuid REFERENCES surface(id),
  hreflang_group   uuid,                          -- versões localizadas da mesma superfície
  published_at     timestamptz,
  retired_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, market_id, locale, url_path),
  CHECK (state <> 'REDIRECT' OR redirect_to IS NOT NULL)
);
CREATE INDEX surface_entity_idx ON surface (entity_id);
CREATE INDEX surface_hreflang_idx ON surface (hreflang_group) WHERE hreflang_group IS NOT NULL;

-- Cada compilação da página: versão do template, do compilador e (se houve) do modelo.
CREATE TABLE surface_version (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  surface_id       uuid NOT NULL REFERENCES surface(id),
  version          int  NOT NULL,
  template_id      uuid REFERENCES template(id),
  compiler_version text NOT NULL,
  model_version    text,                          -- NULL = compilação 100% determinística
  content_hash     text NOT NULL,
  status           text NOT NULL DEFAULT 'compiled'
                     CHECK (status IN ('compiled','blocked','in_review','published','superseded')),
  compiled_at      timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz,
  UNIQUE (surface_id, version)
);

-- Linhagem: quais fatos (versão exata) e relações cada versão de página usa.
CREATE TABLE surface_fact (
  surface_version_id uuid NOT NULL REFERENCES surface_version(id) ON DELETE CASCADE,
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  claim_id           uuid REFERENCES claim(id),
  relation_id        uuid REFERENCES relation(id),
  role               text,                        -- ex.: 'headline','schema','comparison'
  CHECK ((claim_id IS NOT NULL) <> (relation_id IS NOT NULL))
);
CREATE INDEX surface_fact_claim_idx    ON surface_fact (claim_id)    WHERE claim_id IS NOT NULL;
CREATE INDEX surface_fact_relation_idx ON surface_fact (relation_id) WHERE relation_id IS NOT NULL;
CREATE INDEX surface_fact_version_idx  ON surface_fact (surface_version_id);

CREATE TABLE quality_gate_result (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  surface_version_id uuid NOT NULL REFERENCES surface_version(id) ON DELETE CASCADE,
  gate               text NOT NULL,               -- demand, entity, data, evidence, differentiation, cannibalization...
  passed             boolean NOT NULL,
  blocking           boolean NOT NULL DEFAULT true,
  detail             jsonb NOT NULL DEFAULT '{}',
  run_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qgr_version_idx ON quality_gate_result (surface_version_id);

-- ---------------------------------------------------------------- GOVERNANÇA
CREATE TABLE publication_policy (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  risk_tier   text NOT NULL CHECK (risk_tier IN ('low','medium','high')),
  rule        jsonb NOT NULL,                     -- condições: classe da afirmação, nº de páginas afetadas etc.
  action      text NOT NULL CHECK (action IN ('auto_publish','review','human_approval')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE review_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  subject_type  text NOT NULL CHECK (subject_type IN
                  ('surface_version','claim','claim_conflict','entity_merge','opportunity')),
  subject_id    uuid NOT NULL,
  risk_tier     text NOT NULL CHECK (risk_tier IN ('low','medium','high')),
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','changes_requested')),
  assigned_to   text,
  decided_by    text,
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_pending_idx ON review_queue (tenant_id, status, risk_tier);

-- Rastro de decisão: por que cada decisão foi tomada, com a versão da regra.
CREATE TABLE decision_trace (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  subject_type  text NOT NULL,
  subject_id    uuid NOT NULL,
  step          text NOT NULL,
  inputs        jsonb NOT NULL DEFAULT '{}',
  outputs       jsonb NOT NULL DEFAULT '{}',
  rule_version  text,
  actor         text NOT NULL CHECK (actor IN ('system','human','model')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decision_trace_subject_idx ON decision_trace (subject_type, subject_id, created_at);

-- ---------------------------------------------------------------- RESULTADO E PILOTO
-- Métricas observadas (Search Console, GA4, citações de IA, CRM), sempre com período e dimensões.
CREATE TABLE observation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  market_id     uuid REFERENCES market(id),
  surface_id    uuid REFERENCES surface(id),
  city_entity_id uuid REFERENCES entity(id),
  metric        text NOT NULL,                    -- 'gsc_clicks_nonbrand','gsc_impressions','ai_citations',...
  value         numeric NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  dimensions    jsonb NOT NULL DEFAULT '{}',
  source_id     uuid REFERENCES source(id),
  CHECK (period_end >= period_start)
);
CREATE INDEX observation_metric_idx ON observation (tenant_id, metric, city_entity_id, period_start);

CREATE TABLE experiment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  name        text NOT NULL,
  design      text NOT NULL DEFAULT 'matched_did' CHECK (design IN ('matched_did')),
  metric      text NOT NULL,
  start_date  date NOT NULL,
  end_date    date,
  UNIQUE (tenant_id, name)
);

CREATE TABLE experiment_unit (
  experiment_id uuid NOT NULL REFERENCES experiment(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  city_entity_id uuid NOT NULL REFERENCES entity(id),
  arm           text NOT NULL CHECK (arm IN ('treatment','control')),
  match_key     text NOT NULL,                    -- par/grupo de cidades comparáveis
  PRIMARY KEY (experiment_id, city_entity_id)
);

-- ---------------------------------------------------------------- EXECUÇÃO (workflow)
-- Fila de jobs. Consumidores usam: SELECT ... FOR UPDATE SKIP LOCKED.
CREATE TABLE job (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  kind          text NOT NULL,                    -- 'ingest_feed','recompute_opportunity','compile_surface',...
  subject_type  text,
  subject_id    uuid,
  payload       jsonb NOT NULL DEFAULT '{}',
  state         text NOT NULL DEFAULT 'queued'
                  CHECK (state IN ('queued','running','succeeded','failed','blocked')),
  attempt       int NOT NULL DEFAULT 0,
  run_after     timestamptz NOT NULL DEFAULT now(),
  locked_at     timestamptz,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_queue_idx ON job (state, run_after) WHERE state IN ('queued','failed');

-- ---------------------------------------------------------------- CONSULTAS-CHAVE
-- 1) Mudou um fato: quais páginas dependem dele (na versão mais recente de cada superfície).
CREATE FUNCTION surfaces_affected_by_claim(p_claim uuid)
RETURNS TABLE (surface_id uuid, url_path text, surface_version_id uuid, version int) LANGUAGE sql STABLE AS $$
  SELECT s.id, s.url_path, sv.id, sv.version
  FROM surface_fact sf
  JOIN surface_version sv ON sv.id = sf.surface_version_id
  JOIN surface s          ON s.id  = sv.surface_id
  WHERE sf.claim_id = p_claim
    AND sv.version = (SELECT max(version) FROM surface_version WHERE surface_id = s.id)
$$;

-- 2) Prontidão da entidade: o que falta para ser publicável, em contadores separados (sem nota).
CREATE VIEW v_entity_readiness AS
SELECT e.id AS entity_id, e.tenant_id, e.entity_type, e.name,
       count(*) FILTER (WHERE ts.requirement = 'required')                          AS required_total,
       count(c.id) FILTER (WHERE ts.requirement = 'required')                       AS required_present,
       count(c.id) FILTER (WHERE ts.requirement = 'required'
                           AND c.claim_class = 'VERIFIED')                          AS required_verified,
       count(c.id) FILTER (WHERE ts.requirement = 'required'
                           AND ts.freshness_sla IS NOT NULL
                           AND c.observed_at < now() - ts.freshness_sla)            AS required_stale
FROM entity e
JOIN entity_type_schema ts ON ts.tenant_id = e.tenant_id AND ts.entity_type = e.entity_type
LEFT JOIN LATERAL (
  SELECT c2.id, c2.claim_class, c2.observed_at
  FROM claim c2
  WHERE c2.entity_id = e.id AND c2.attribute_key = ts.attribute_key AND c2.status = 'active'
  ORDER BY c2.observed_at DESC LIMIT 1
) c ON true
WHERE e.status = 'active'
GROUP BY e.id, e.tenant_id, e.entity_type, e.name;

-- ---------------------------------------------------------------- ISOLAMENTO POR TENANT (RLS)
-- A aplicação define:  SET menlo.tenant_id = '<uuid>';  em cada conexão/transação.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'menlo' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE menlo.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON menlo.%I
                      USING (tenant_id = nullif(current_setting('menlo.tenant_id', true), '')::uuid)
                      WITH CHECK (tenant_id = nullif(current_setting('menlo.tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;
-- A tabela tenant não tem coluna tenant_id (ela é a raiz): o acesso a ela fica restrito por GRANT.
