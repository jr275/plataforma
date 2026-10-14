-- 0017_agents_blueprint: auditoria dos agentes de runtime (spec seção 14), explicação da decisão e o Blueprint da especificação (seção 11). Histórico imutável (SELECT/INSERT).
-- O LLM nunca decide: `agent_run` guarda prompt (versão e sha), modelo, entrada, saída, tentativas, erros e tokens; `decision_explanation` liga a explicação à decisão sem poder alterá-la.

ALTER TABLE plataforma.growth_opportunity ADD COLUMN intent_model jsonb CHECK (intent_model IS NULL OR jsonb_typeof(intent_model) = 'object');

CREATE TABLE plataforma.agent_run (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id       uuid        NOT NULL REFERENCES plataforma.tenant (id),
  agent           integer     NOT NULL CHECK (agent BETWEEN 1 AND 8),
  agent_name      text        NOT NULL CHECK (length(agent_name) BETWEEN 1 AND 80),
  prompt_version  text        NOT NULL CHECK (length(prompt_version) BETWEEN 1 AND 80),
  prompt_sha256   text        NOT NULL CHECK (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  model           text        NOT NULL CHECK (length(model) BETWEEN 1 AND 100),
  status          text        NOT NULL CHECK (status IN ('succeeded', 'failed', 'not_configured')),
  attempts        integer     NOT NULL CHECK (attempts BETWEEN 0 AND 3),
  subject_kind    text        CHECK (subject_kind IS NULL OR length(subject_kind) <= 40),
  subject_ref     text        CHECK (subject_ref IS NULL OR length(subject_ref) <= 200),
  input           jsonb       NOT NULL,
  output          jsonb,
  errors          jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(errors) = 'array'),
  usage           jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(usage) = 'object'),
  created_by      text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((status = 'succeeded') = (output IS NOT NULL)),
  CHECK (status <> 'not_configured' OR attempts = 0)
);
CREATE INDEX agent_run_recent_idx ON plataforma.agent_run (tenant_id, seq DESC);
CREATE INDEX agent_run_subject_idx ON plataforma.agent_run (tenant_id, subject_kind, subject_ref);

CREATE TABLE plataforma.decision_explanation (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL REFERENCES plataforma.tenant (id),
  decision_id        uuid        NOT NULL,
  agent_run_id       uuid        NOT NULL,
  explanation        text        NOT NULL CHECK (length(explanation) BETWEEN 1 AND 2000),
  next_best_action   text        NOT NULL CHECK (length(next_best_action) BETWEEN 1 AND 1000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, decision_id) REFERENCES plataforma.eligibility_decision (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_run_id) REFERENCES plataforma.agent_run (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, decision_id)
);

CREATE TABLE plataforma.spec_blueprint (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id       uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id  uuid        NOT NULL,
  version         integer     NOT NULL CHECK (version >= 1),
  status          text        NOT NULL CHECK (status IN ('COMPLETE', 'SEMANTIC_INSUFFICIENT')),
  -- de onde vêm os campos semânticos: regras do pack e fatos (code) ou o Agente 6 (agent6)
  semantic_source text        NOT NULL CHECK (semantic_source IN ('code', 'agent6')),
  content         jsonb       NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_hash    text        NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  -- hash do conteúdo SEM template e módulos de apresentação: trocar o template não altera o blueprint
  structural_hash text        NOT NULL CHECK (structural_hash ~ '^[0-9a-f]{64}$'),
  template_id     text        NOT NULL CHECK (length(template_id) BETWEEN 1 AND 80),
  template_gap    boolean     NOT NULL,
  agent_run_id    uuid,
  created_by      text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_run_id) REFERENCES plataforma.agent_run (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, opportunity_id, version),
  UNIQUE (tenant_id, opportunity_id, content_hash),
  CHECK ((semantic_source = 'agent6') = (agent_run_id IS NOT NULL))
);
CREATE INDEX spec_blueprint_latest_idx ON plataforma.spec_blueprint (tenant_id, opportunity_id, version DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_run', 'decision_explanation', 'spec_blueprint'] LOOP
    EXECUTE format('ALTER TABLE plataforma.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE plataforma.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON plataforma.%I AS PERMISSIVE FOR ALL TO menlo_app USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id())', t);
    EXECUTE format('REVOKE ALL ON TABLE plataforma.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE plataforma.%I TO menlo_app', t);
  END LOOP;
END $$;
