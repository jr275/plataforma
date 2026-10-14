-- 0008_opportunity_engine: Query Opportunity Engine (ADR-023). Sete tabelas do tenant. A tabela legada `opportunity` (0002) NÃO é alterada.
-- Histórico imutável (sem UPDATE nem DELETE para a aplicação): evidence, opportunity_evidence, score_config, opportunity_score, opportunity_event.
-- A tabela de transições do ciclo de vida abaixo é gerada a partir de packages/api/src/engine/lifecycle.ts; um teste de produto confere os dois.

CREATE TABLE plataforma.research_run (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES plataforma.tenant (id),
  vertical_id text        NOT NULL CHECK (vertical_id ~ '^[a-z][a-z0-9-]{2,40}$'),
  status      text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  params      jsonb       NOT NULL CHECK (jsonb_typeof(params) = 'object'),
  adapters    jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(adapters) = 'array'),
  stats       jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(stats) = 'object'),
  error       text        CHECK (error IS NULL OR length(error) <= 2000),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_by  text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  UNIQUE (tenant_id, id),
  CHECK ((status = 'running') = (finished_at IS NULL))
);
-- uma pesquisa em andamento por tenant (como a geração, ADR-020)
CREATE UNIQUE INDEX research_run_one_running_idx ON plataforma.research_run (tenant_id) WHERE status = 'running';
CREATE INDEX research_run_recent_idx ON plataforma.research_run (tenant_id, started_at DESC);

CREATE TABLE plataforma.evidence (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES plataforma.tenant (id),
  run_id       uuid        NOT NULL,
  adapter      text        NOT NULL CHECK (length(adapter) BETWEEN 1 AND 60),
  kind         text        NOT NULL CHECK (kind IN ('news_item', 'indicator')),
  source_ref   text        NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 400),
  url          text        NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 2000),
  title        text        NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  summary      text        CHECK (summary IS NULL OR length(summary) <= 1000),
  published_at timestamptz,
  collected_at timestamptz NOT NULL,
  valid_until  timestamptz,
  basis        text        NOT NULL CHECK (basis IN ('observed', 'provider_metric', 'derived', 'inferred', 'estimated', 'unknown')),
  payload      jsonb       NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  topics       text[]      NOT NULL DEFAULT '{}',
  limitations  text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(limitations) <= 20),
  content_hash text        NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, run_id) REFERENCES plataforma.research_run (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, adapter, source_ref, content_hash)
);
CREATE INDEX evidence_recent_idx ON plataforma.evidence (tenant_id, collected_at DESC);
CREATE INDEX evidence_source_idx ON plataforma.evidence (tenant_id, adapter, source_ref, collected_at DESC);

CREATE TABLE plataforma.score_config (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES plataforma.tenant (id),
  vertical_id text        NOT NULL CHECK (vertical_id ~ '^[a-z][a-z0-9-]{2,40}$'),
  version     integer     NOT NULL CHECK (version >= 1),
  config      jsonb       NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  config_hash text        NOT NULL CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  note        text        CHECK (note IS NULL OR length(note) <= 500),
  created_by  text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, vertical_id, version),
  UNIQUE (tenant_id, vertical_id, config_hash)
);

CREATE TABLE plataforma.growth_opportunity (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  vertical_id      text        NOT NULL CHECK (vertical_id ~ '^[a-z][a-z0-9-]{2,40}$'),
  cluster_key      text        NOT NULL CHECK (length(cluster_key) BETWEEN 1 AND 300),
  pattern_key      text        NOT NULL CHECK (length(pattern_key) BETWEEN 1 AND 120),
  primary_query    text        NOT NULL CHECK (length(primary_query) BETWEEN 1 AND 300),
  variants         text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(variants) <= 50),
  language         text        NOT NULL CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  country          text        NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  location         jsonb       CHECK (location IS NULL OR jsonb_typeof(location) = 'object'),
  entity_kind      text        CHECK (entity_kind IS NULL OR entity_kind = 'city'),
  entity_id        uuid,
  intent           text        NOT NULL CHECK (length(intent) BETWEEN 1 AND 60),
  stage            text        NOT NULL CHECK (length(stage) BETWEEN 1 AND 60),
  jtbd             text        NOT NULL CHECK (length(jtbd) BETWEEN 1 AND 500),
  experience       text        NOT NULL CHECK (length(experience) BETWEEN 1 AND 60),
  expected_outcome text        NOT NULL CHECK (length(expected_outcome) BETWEEN 1 AND 300),
  hypothesis       boolean     NOT NULL DEFAULT true,
  demand           jsonb       NOT NULL CHECK (jsonb_typeof(demand) = 'object'),
  trend            jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(trend) = 'array'),
  status           text        NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered', 'validated', 'scored', 'eligible', 'serp_analyzed', 'blueprinted', 'data_assembled', 'evidence_validated', 'experience_built', 'qa', 'published', 'indexed', 'monitored', 'converted', 'measured', 'learned', 'refreshed', 'retired', 'rejected')),
  blockers         jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(blockers) = 'array'),
  validation       jsonb       NOT NULL CHECK (jsonb_typeof(validation) = 'object'),
  first_run_id     uuid        NOT NULL,
  last_run_id      uuid        NOT NULL,
  latest_score_id  uuid,
  priority_value   numeric(6, 3) CHECK (priority_value IS NULL OR priority_value BETWEEN 0 AND 100),
  priority_kind    text        CHECK (priority_kind IS NULL OR priority_kind IN ('overall', 'partial', 'none')),
  eligible         boolean,
  commercial_value numeric(6, 3) CHECK (commercial_value IS NULL OR commercial_value BETWEEN 0 AND 100),
  feasibility      numeric(6, 3) CHECK (feasibility IS NULL OR feasibility BETWEEN 0 AND 100),
  discovery        numeric(6, 3) CHECK (discovery IS NULL OR discovery BETWEEN 0 AND 100),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((entity_kind IS NULL) = (entity_id IS NULL)),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES plataforma.city (tenant_id, id),
  FOREIGN KEY (tenant_id, first_run_id) REFERENCES plataforma.research_run (tenant_id, id),
  FOREIGN KEY (tenant_id, last_run_id) REFERENCES plataforma.research_run (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, vertical_id, cluster_key)
);
CREATE INDEX growth_opportunity_rank_idx ON plataforma.growth_opportunity (tenant_id, priority_value DESC NULLS LAST, id);
CREATE INDEX growth_opportunity_status_idx ON plataforma.growth_opportunity (tenant_id, status);
CREATE INDEX growth_opportunity_entity_idx ON plataforma.growth_opportunity (tenant_id, entity_id);
CREATE TRIGGER growth_opportunity_set_updated_at BEFORE UPDATE ON plataforma.growth_opportunity
  FOR EACH ROW EXECUTE FUNCTION plataforma.set_updated_at();

CREATE TABLE plataforma.opportunity_evidence (
  tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id uuid        NOT NULL,
  evidence_id    uuid        NOT NULL,
  role           text        NOT NULL CHECK (role IN ('signal', 'requirement')),
  reason         text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  topic          text        CHECK (topic IS NULL OR length(topic) <= 80),
  run_id         uuid        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (opportunity_id, evidence_id, role),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, evidence_id) REFERENCES plataforma.evidence (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES plataforma.research_run (tenant_id, id)
);
CREATE INDEX opportunity_evidence_evidence_idx ON plataforma.opportunity_evidence (tenant_id, evidence_id);

CREATE TABLE plataforma.opportunity_score (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id uuid        NOT NULL,
  config_id      uuid        NOT NULL,
  model_version  text        NOT NULL CHECK (length(model_version) BETWEEN 1 AND 60),
  inputs_hash    text        NOT NULL CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
  strategic      boolean     NOT NULL,
  dimensions     jsonb       NOT NULL CHECK (jsonb_typeof(dimensions) = 'object'),
  result         jsonb       NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  priority_value numeric(6, 3) CHECK (priority_value IS NULL OR priority_value BETWEEN 0 AND 100),
  priority_kind  text        NOT NULL CHECK (priority_kind IN ('overall', 'partial', 'none')),
  eligible       boolean     NOT NULL,
  confidence     numeric(5, 4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_by     text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, config_id) REFERENCES plataforma.score_config (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (opportunity_id, config_id, inputs_hash)
);
CREATE INDEX opportunity_score_history_idx ON plataforma.opportunity_score (tenant_id, opportunity_id, created_at DESC);
ALTER TABLE plataforma.growth_opportunity
  ADD FOREIGN KEY (tenant_id, latest_score_id) REFERENCES plataforma.opportunity_score (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE plataforma.opportunity_event (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Ordem do histórico: eventos da mesma transação têm o mesmo created_at; a sequência fixa a ordem em que foram gravados.
  seq            bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id uuid        NOT NULL,
  event_type     text        NOT NULL CHECK (event_type IN ('discovered', 'transition', 'score', 'research', 'blueprint', 'blocker', 'note')),
  from_status    text        CHECK (from_status IS NULL OR from_status IN ('discovered', 'validated', 'scored', 'eligible', 'serp_analyzed', 'blueprinted', 'data_assembled', 'evidence_validated', 'experience_built', 'qa', 'published', 'indexed', 'monitored', 'converted', 'measured', 'learned', 'refreshed', 'retired', 'rejected')),
  to_status      text        CHECK (to_status IS NULL OR to_status IN ('discovered', 'validated', 'scored', 'eligible', 'serp_analyzed', 'blueprinted', 'data_assembled', 'evidence_validated', 'experience_built', 'qa', 'published', 'indexed', 'monitored', 'converted', 'measured', 'learned', 'refreshed', 'retired', 'rejected')),
  actor          text        NOT NULL CHECK (length(actor) BETWEEN 1 AND 200),
  reason         text        CHECK (reason IS NULL OR length(reason) <= 1000),
  data           jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(data) = 'object'),
  run_id         uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES plataforma.research_run (tenant_id, id),
  CHECK (event_type <> 'transition' OR (from_status IS NOT NULL AND to_status IS NOT NULL))
);
CREATE INDEX opportunity_event_history_idx ON plataforma.opportunity_event (tenant_id, opportunity_id, seq);

-- Ciclo de vida: UMA tabela de transições (gerada de lifecycle.ts). O mesmo estado é permitido (atualizar outros campos).
CREATE FUNCTION plataforma.opportunity_transition_ok(old_status text, new_status text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
  SELECT old_status = new_status OR (old_status, new_status) IN (VALUES
    ('discovered', 'validated'),
    ('discovered', 'rejected'),
    ('discovered', 'retired'),
    ('validated', 'scored'),
    ('validated', 'rejected'),
    ('validated', 'retired'),
    ('scored', 'eligible'),
    ('scored', 'retired'),
    ('eligible', 'serp_analyzed'),
    ('eligible', 'blueprinted'),
    ('eligible', 'scored'),
    ('eligible', 'retired'),
    ('serp_analyzed', 'blueprinted'),
    ('serp_analyzed', 'scored'),
    ('serp_analyzed', 'retired'),
    ('blueprinted', 'data_assembled'),
    ('blueprinted', 'serp_analyzed'),
    ('blueprinted', 'retired'),
    ('data_assembled', 'evidence_validated'),
    ('data_assembled', 'blueprinted'),
    ('data_assembled', 'retired'),
    ('evidence_validated', 'experience_built'),
    ('evidence_validated', 'data_assembled'),
    ('evidence_validated', 'retired'),
    ('experience_built', 'qa'),
    ('experience_built', 'evidence_validated'),
    ('experience_built', 'retired'),
    ('qa', 'published'),
    ('qa', 'experience_built'),
    ('qa', 'retired'),
    ('published', 'indexed'),
    ('published', 'retired'),
    ('indexed', 'monitored'),
    ('indexed', 'retired'),
    ('monitored', 'converted'),
    ('monitored', 'measured'),
    ('monitored', 'retired'),
    ('converted', 'measured'),
    ('converted', 'retired'),
    ('measured', 'learned'),
    ('measured', 'retired'),
    ('learned', 'refreshed'),
    ('learned', 'retired'),
    ('refreshed', 'scored'),
    ('refreshed', 'retired'),
    ('rejected', 'discovered'),
    ('rejected', 'retired')
  )
$$;
CREATE FUNCTION plataforma.growth_opportunity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.vertical_id <> OLD.vertical_id OR NEW.cluster_key <> OLD.cluster_key THEN
    RAISE EXCEPTION 'a identidade da oportunidade é imutável' USING ERRCODE = '23514';
  END IF;
  IF NOT plataforma.opportunity_transition_ok(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'transição de ciclo de vida inválida: % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER growth_opportunity_guard BEFORE UPDATE ON plataforma.growth_opportunity
  FOR EACH ROW EXECUTE FUNCTION plataforma.growth_opportunity_guard();

ALTER TABLE plataforma.research_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.research_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.research_run AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());
ALTER TABLE plataforma.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.evidence AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());
ALTER TABLE plataforma.score_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.score_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.score_config AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());
ALTER TABLE plataforma.growth_opportunity ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.growth_opportunity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.growth_opportunity AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());
ALTER TABLE plataforma.opportunity_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.opportunity_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.opportunity_evidence AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());
ALTER TABLE plataforma.opportunity_score ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.opportunity_score FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.opportunity_score AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());
ALTER TABLE plataforma.opportunity_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.opportunity_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.opportunity_event AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());

REVOKE ALL ON TABLE plataforma.research_run, plataforma.evidence, plataforma.score_config, plataforma.growth_opportunity, plataforma.opportunity_evidence, plataforma.opportunity_score, plataforma.opportunity_event FROM PUBLIC;
REVOKE ALL ON FUNCTION plataforma.opportunity_transition_ok(text, text), plataforma.growth_opportunity_guard() FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE plataforma.research_run, plataforma.growth_opportunity TO menlo_app;
GRANT SELECT, INSERT ON TABLE plataforma.evidence, plataforma.score_config, plataforma.opportunity_evidence, plataforma.opportunity_score, plataforma.opportunity_event TO menlo_app;
GRANT EXECUTE ON FUNCTION plataforma.opportunity_transition_ok(text, text) TO menlo_app;
