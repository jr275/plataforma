-- 0015_combination_log: motivo de CADA poda do Combination Engine (spec seção 7), para a árvore pai → filho ser inspecionável. Histórico imutável (SELECT/INSERT).
-- Nenhuma combinação é descartada em silêncio: o que foi mantido, podado (com o filtro e o motivo), duplicado ou cortado pelo teto da execução fica registrado.
CREATE TABLE plataforma.combination_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES plataforma.tenant (id),
  run_id          uuid        NOT NULL,
  topic_id        text        NOT NULL CHECK (topic_id ~ '^[0-9a-f]{64}$'),
  parent_topic_id text        CHECK (parent_topic_id IS NULL OR parent_topic_id ~ '^[0-9a-f]{64}$'),
  family          text        NOT NULL CHECK (length(family) BETWEEN 1 AND 80),
  level           integer     NOT NULL CHECK (level >= 1),
  dimensions      jsonb       NOT NULL CHECK (jsonb_typeof(dimensions) = 'object'),
  outcome         text        NOT NULL CHECK (outcome IN ('kept', 'pruned', 'duplicate', 'capped')),
  -- filtro que decidiu (F1..F7 ou o teto); `kept` e `duplicate` guardam NULL
  filter          text        CHECK (filter IS NULL OR filter IN ('F1_semantic', 'F2_entity_geo', 'F3_depth', 'F4_data_sufficiency', 'F5_parent_redundancy', 'F6_demand', 'F7_cannibalization', 'cap')),
  reason          text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  details         jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, run_id) REFERENCES plataforma.research_run (tenant_id, id),
  UNIQUE (tenant_id, id),
  CHECK ((outcome IN ('kept', 'duplicate')) = (filter IS NULL))
);
CREATE INDEX combination_log_run_idx ON plataforma.combination_log (tenant_id, run_id, level, outcome);
CREATE INDEX combination_log_topic_idx ON plataforma.combination_log (tenant_id, topic_id);
CREATE INDEX combination_log_parent_idx ON plataforma.combination_log (tenant_id, parent_topic_id);

ALTER TABLE plataforma.combination_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.combination_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.combination_log AS PERMISSIVE FOR ALL TO menlo_app USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());
REVOKE ALL ON TABLE plataforma.combination_log FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE plataforma.combination_log TO menlo_app;
