-- 0003_import: histórico de importações em lote (ADR-017). `import_run` é a execução; `import_record` é UMA linha por registro
-- lido, com o desfecho e TODOS os motivos. Nada é descartado em silêncio: aceitas + rejeitadas + duplicadas = total.
-- FKs compostas (tenant_id, id) impedem que um registro aponte para uma execução de outro tenant.

CREATE TABLE plataforma.import_run (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL REFERENCES plataforma.tenant (id),
  kind          text        NOT NULL CHECK (kind IN ('csv')),
  source_name   text        NOT NULL CHECK (length(source_name) BETWEEN 1 AND 120),
  file_name     text        NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  file_sha256   text        NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  origin        text        NOT NULL CHECK (origin IN ('real', 'test', 'manual')),
  mapping       jsonb       NOT NULL CHECK (jsonb_typeof(mapping) = 'object'),
  status        text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  total_rows    integer     NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  accepted_rows integer     NOT NULL DEFAULT 0 CHECK (accepted_rows >= 0),
  rejected_rows integer     NOT NULL DEFAULT 0 CHECK (rejected_rows >= 0),
  duplicate_rows integer    NOT NULL DEFAULT 0 CHECK (duplicate_rows >= 0),
  error         text        CHECK (error IS NULL OR length(error) <= 2000),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  created_by    text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  UNIQUE (tenant_id, id),
  CHECK (accepted_rows + rejected_rows + duplicate_rows = total_rows),
  CHECK ((status = 'running') = (finished_at IS NULL)),
  CHECK (status <> 'failed' OR error IS NOT NULL)
);
CREATE INDEX import_run_tenant_started_idx ON plataforma.import_run (tenant_id, started_at DESC);

CREATE TABLE plataforma.import_record (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid    NOT NULL REFERENCES plataforma.tenant (id),
  run_id     uuid    NOT NULL,
  row_number integer NOT NULL CHECK (row_number >= 1),
  raw        jsonb   NOT NULL CHECK (jsonb_typeof(raw) = 'object'),
  outcome    text    NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'duplicate')),
  issues     jsonb   NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issues) = 'array'),
  entity_id  uuid,
  FOREIGN KEY (tenant_id, run_id) REFERENCES plataforma.import_run (tenant_id, id),
  UNIQUE (tenant_id, run_id, row_number)
);
CREATE INDEX import_record_run_idx ON plataforma.import_record (tenant_id, run_id, row_number);

ALTER TABLE plataforma.import_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.import_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.import_run AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id())
  WITH CHECK (tenant_id = plataforma.current_tenant_id());

ALTER TABLE plataforma.import_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.import_record FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.import_record AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id())
  WITH CHECK (tenant_id = plataforma.current_tenant_id());

-- Sem DELETE. `import_record` é o histórico: só SELECT e INSERT (imutável para a aplicação).
REVOKE ALL ON TABLE plataforma.import_run, plataforma.import_record FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE plataforma.import_run TO menlo_app;
GRANT SELECT, INSERT ON TABLE plataforma.import_record TO menlo_app;
