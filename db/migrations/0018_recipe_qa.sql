-- 0018_recipe_qa: recipe compilado (spec seção 11/13: blueprint + template + módulos + dados + narrativa) e relatório de QA Q1–Q14 (seção 13.2). Histórico imutável (SELECT/INSERT).
-- Nada aqui publica nem indexa: o recipe é sempre `noindex` e o QA só registra resultados. Um gate não executado é NOT_RUN: nunca é aprovado por padrão.

CREATE TABLE plataforma.page_recipe (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id   uuid        NOT NULL,
  spec_blueprint_id uuid       NOT NULL,
  version          integer     NOT NULL CHECK (version >= 1),
  -- de onde vem a narrativa: template determinístico do pack (fatos com referência) ou o Agente 7
  narrative_source text        NOT NULL CHECK (narrative_source IN ('template', 'agent7')),
  content          jsonb       NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_hash     text        NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  agent_run_id     uuid,
  created_by       text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, spec_blueprint_id) REFERENCES plataforma.spec_blueprint (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_run_id) REFERENCES plataforma.agent_run (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, opportunity_id, version),
  UNIQUE (tenant_id, opportunity_id, content_hash),
  CHECK ((narrative_source = 'agent7') = (agent_run_id IS NOT NULL))
);
CREATE INDEX page_recipe_latest_idx ON plataforma.page_recipe (tenant_id, opportunity_id, version DESC);

CREATE TABLE plataforma.qa_report (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq               bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id         uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id    uuid        NOT NULL,
  recipe_id         uuid        NOT NULL,
  reference_time    timestamptz NOT NULL,
  -- Q1..Q14: { status: PASS | FAIL | NOT_RUN, by: code | llm | both, blocking, issues[], detail }
  results           jsonb       NOT NULL CHECK (jsonb_typeof(results) = 'object'),
  -- QA_PASSED: os 14 passaram; QA_FAILED: algum falhou; QA_INCOMPLETE: nenhum falhou mas algum não rodou (ex.: Q14 sem o verificador)
  outcome           text        NOT NULL CHECK (outcome IN ('QA_PASSED', 'QA_FAILED', 'QA_INCOMPLETE')),
  blocking_failures jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(blocking_failures) = 'array'),
  agent_run_id      uuid,
  created_by        text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, recipe_id) REFERENCES plataforma.page_recipe (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_run_id) REFERENCES plataforma.agent_run (tenant_id, id),
  UNIQUE (tenant_id, id)
);
CREATE INDEX qa_report_latest_idx ON plataforma.qa_report (tenant_id, opportunity_id, seq DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['page_recipe', 'qa_report'] LOOP
    EXECUTE format('ALTER TABLE plataforma.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE plataforma.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON plataforma.%I AS PERMISSIVE FOR ALL TO menlo_app USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id())', t);
    EXECUTE format('REVOKE ALL ON TABLE plataforma.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE plataforma.%I TO menlo_app', t);
  END LOOP;
END $$;
