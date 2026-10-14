-- 0019_agent_runtime: camada de execução dos agentes (registro, versões de prompt, execuções rastreadas, pipeline com passos retomáveis, auditoria de decisões).
-- Princípio: o LLM propõe; a aplicação valida; o motor determinístico decide; o Control Plane explica; a auditoria prova o que aconteceu.
-- Tudo por tenant com RLS forçada. Histórico é só INSERT; as poucas colunas de estado têm UPDATE por coluna.

-- Execução de agente: ganha rastreio (pipeline, correlação, versão de prompt do registro), duração e os estados INVALID_OUTPUT / TIMED_OUT / CANCELLED.
ALTER TABLE plataforma.agent_run DROP CONSTRAINT agent_run_status_check;
ALTER TABLE plataforma.agent_run ADD CONSTRAINT agent_run_status_check CHECK (status IN ('succeeded', 'failed', 'invalid_output', 'timed_out', 'cancelled', 'not_configured'));
ALTER TABLE plataforma.agent_run ADD COLUMN pipeline_run_id uuid, ADD COLUMN correlation_id text CHECK (correlation_id IS NULL OR length(correlation_id) BETWEEN 1 AND 120), ADD COLUMN prompt_version_id uuid, ADD COLUMN duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0);
CREATE INDEX agent_run_pipeline_idx ON plataforma.agent_run (tenant_id, pipeline_run_id) WHERE pipeline_run_id IS NOT NULL;

-- Definição do agente (versionada, só INSERT): id estável, versões de esquema, modelo, tempo, tentativas, lote e dependências.
CREATE TABLE plataforma.agent_definition (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES plataforma.tenant (id),
  agent                 integer     NOT NULL CHECK (agent BETWEEN 1 AND 8),
  version               integer     NOT NULL CHECK (version >= 1),
  slug                  text        NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,60}$'),
  name                  text        NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  stage                 text        NOT NULL CHECK (stage IN ('topic', 'page')),
  input_schema_version  text        NOT NULL CHECK (length(input_schema_version) BETWEEN 1 AND 20),
  output_schema_version text        NOT NULL CHECK (length(output_schema_version) BETWEEN 1 AND 20),
  model                 text        NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  timeout_ms            integer     NOT NULL CHECK (timeout_ms BETWEEN 1000 AND 600000),
  max_retries           integer     NOT NULL CHECK (max_retries BETWEEN 0 AND 5),
  batch_min             integer     NOT NULL CHECK (batch_min >= 1),
  batch_max             integer     NOT NULL CHECK (batch_max >= batch_min AND batch_max <= 100),
  depends_on            integer[]   NOT NULL DEFAULT '{}',
  definition_hash       text        NOT NULL CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  created_by            text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, agent, version),
  UNIQUE (tenant_id, agent, definition_hash)
);

-- Versão de prompt: corpo imutável (sem UPDATE de conteúdo); só o estado muda. Uma ATIVA por (tenant, agente, pacote de domínio).
CREATE TABLE plataforma.prompt_version (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  agent            integer     NOT NULL CHECK (agent BETWEEN 1 AND 8),
  domain_pack_id   text        NOT NULL CHECK (length(domain_pack_id) BETWEEN 1 AND 60),
  version          text        NOT NULL CHECK (length(version) BETWEEN 1 AND 80),
  status           text        NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'DEPRECATED')),
  body             text        NOT NULL CHECK (length(body) BETWEEN 1 AND 60000),
  body_sha256      text        NOT NULL CHECK (body_sha256 ~ '^[0-9a-f]{64}$'),
  header_sha256    text        NOT NULL CHECK (header_sha256 ~ '^[0-9a-f]{64}$'),
  placeholders     jsonb       NOT NULL CHECK (jsonb_typeof(placeholders) = 'array'),
  source           text        NOT NULL CHECK (source IN ('file', 'control_plane')),
  change_log       text        NOT NULL CHECK (length(change_log) BETWEEN 1 AND 2000),
  regression       jsonb       CHECK (regression IS NULL OR jsonb_typeof(regression) = 'object'),
  created_by       text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  activated_at     timestamptz,
  deprecated_at    timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, agent, domain_pack_id, body_sha256),
  UNIQUE (tenant_id, agent, domain_pack_id, version)
);
CREATE UNIQUE INDEX prompt_version_one_active ON plataforma.prompt_version (tenant_id, agent, domain_pack_id) WHERE status = 'ACTIVE';

CREATE FUNCTION plataforma.prompt_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF (OLD.status, NEW.status) NOT IN (('DRAFT', 'ACTIVE'), ('DRAFT', 'DEPRECATED'), ('ACTIVE', 'DEPRECATED'), ('DEPRECATED', 'ACTIVE')) THEN
    RAISE EXCEPTION 'transição de prompt inválida: % → %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'ACTIVE' THEN NEW.activated_at := now(); NEW.deprecated_at := NULL; END IF;
  IF NEW.status = 'DEPRECATED' THEN NEW.deprecated_at := now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prompt_version_guard BEFORE UPDATE ON plataforma.prompt_version FOR EACH ROW EXECUTE FUNCTION plataforma.prompt_version_guard();
ALTER TABLE plataforma.agent_run ADD FOREIGN KEY (tenant_id, prompt_version_id) REFERENCES plataforma.prompt_version (tenant_id, id);

-- Execução do pipeline (por oportunidade ou lote) e seus passos: retomável e idempotente (chave por passo).
CREATE TABLE plataforma.pipeline_run (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  pipeline         text        NOT NULL CHECK (pipeline IN ('page', 'topic')),
  correlation_id   text        NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 120),
  opportunity_id   uuid,
  -- real = LLM real; test_simulation = LLM roteirizado/fixtures (nunca apresentado como resultado real)
  mode             text        NOT NULL CHECK (mode IN ('real', 'test_simulation')),
  status           text        NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'BLOCKED', 'NEEDS_REVIEW')),
  -- decisão final do Quality Gate Engine (código): APPROVED / BLOCKED / NEEDS_REVIEW
  final_outcome    text        CHECK (final_outcome IS NULL OR final_outcome IN ('APPROVED', 'BLOCKED', 'NEEDS_REVIEW')),
  summary          text        CHECK (summary IS NULL OR length(summary) <= 2000),
  params           jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(params) = 'object'),
  cancel_requested boolean     NOT NULL DEFAULT false,
  created_by       text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, correlation_id),
  CHECK (final_outcome IS NULL OR status IN ('SUCCEEDED', 'BLOCKED', 'NEEDS_REVIEW'))
);
CREATE INDEX pipeline_run_recent_idx ON plataforma.pipeline_run (tenant_id, seq DESC);
ALTER TABLE plataforma.agent_run ADD FOREIGN KEY (tenant_id, pipeline_run_id) REFERENCES plataforma.pipeline_run (tenant_id, id);

CREATE TABLE plataforma.pipeline_step (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  pipeline_run_id  uuid        NOT NULL,
  step_key         text        NOT NULL CHECK (step_key ~ '^[a-z0-9_.:-]{2,80}$'),
  kind             text        NOT NULL CHECK (kind IN ('agent', 'engine')),
  agent            integer     CHECK (agent IS NULL OR agent BETWEEN 1 AND 8),
  status           text        NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'BLOCKED', 'CANCELLED')),
  attempts         integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  idempotency_key  text        NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  agent_run_id     uuid,
  result           jsonb       CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  error            text        CHECK (error IS NULL OR length(error) <= 2000),
  started_at       timestamptz,
  finished_at      timestamptz,
  FOREIGN KEY (tenant_id, pipeline_run_id) REFERENCES plataforma.pipeline_run (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_run_id) REFERENCES plataforma.agent_run (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pipeline_run_id, step_key),
  CHECK ((kind = 'agent') = (agent IS NOT NULL))
);

-- Auditoria de decisão: quem decidiu o quê, a partir de qual recomendação e com quais evidências. O agente recomenda; o código aplica (decided_by = code).
CREATE TABLE plataforma.decision_audit (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  pipeline_run_id  uuid,
  subject_kind     text        NOT NULL CHECK (length(subject_kind) BETWEEN 1 AND 40),
  subject_ref      text        NOT NULL CHECK (length(subject_ref) BETWEEN 1 AND 200),
  decision         text        NOT NULL CHECK (length(decision) BETWEEN 1 AND 80),
  decided_by       text        NOT NULL CHECK (decided_by IN ('code', 'human')),
  recommendation   jsonb       CHECK (recommendation IS NULL OR jsonb_typeof(recommendation) = 'object'),
  recommendation_applied boolean NOT NULL,
  reason           text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  evidence_refs    jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence_refs) = 'array'),
  agent_run_id     uuid,
  created_by       text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, pipeline_run_id) REFERENCES plataforma.pipeline_run (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_run_id) REFERENCES plataforma.agent_run (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX decision_audit_subject_idx ON plataforma.decision_audit (tenant_id, subject_kind, subject_ref, seq DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_definition', 'prompt_version', 'pipeline_run', 'pipeline_step', 'decision_audit'] LOOP
    EXECUTE format('ALTER TABLE plataforma.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE plataforma.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON plataforma.%I AS PERMISSIVE FOR ALL TO menlo_app USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id())', t);
    EXECUTE format('REVOKE ALL ON TABLE plataforma.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE plataforma.%I TO menlo_app', t);
  END LOOP;
END $$;
GRANT UPDATE (status, regression) ON TABLE plataforma.prompt_version TO menlo_app;
GRANT UPDATE (status, final_outcome, summary, cancel_requested, finished_at) ON TABLE plataforma.pipeline_run TO menlo_app;
GRANT UPDATE (status, attempts, idempotency_key, agent_run_id, result, error, started_at, finished_at) ON TABLE plataforma.pipeline_step TO menlo_app;
