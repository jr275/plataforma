-- 0005_generation_run: execução de geração de páginas em lote (ADR-020). Uma linha por execução; os itens (um por cidade tentada)
-- ficam em 0006. Sem DELETE para a aplicação. Páginas geradas são só `draft` (nenhuma publicação nesta etapa).

CREATE TABLE plataforma.generation_run (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  template_key     text        NOT NULL CHECK (length(template_key) BETWEEN 1 AND 80),
  template_version integer     NOT NULL CHECK (template_version >= 1),
  template_hash    text        NOT NULL CHECK (template_hash ~ '^[0-9a-f]{64}$'),
  scope            jsonb       NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  status           text        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  total_items      integer     NOT NULL DEFAULT 0 CHECK (total_items >= 0 AND total_items <= 500),
  generated_items  integer     NOT NULL DEFAULT 0 CHECK (generated_items >= 0),
  unchanged_items  integer     NOT NULL DEFAULT 0 CHECK (unchanged_items >= 0),
  blocked_items    integer     NOT NULL DEFAULT 0 CHECK (blocked_items >= 0),
  error            text        CHECK (error IS NULL OR length(error) <= 2000),
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  created_by       text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  UNIQUE (tenant_id, id),
  CHECK (generated_items + unchanged_items + blocked_items = total_items),
  CHECK ((status = 'running') = (finished_at IS NULL)),
  CHECK (status <> 'failed' OR error IS NOT NULL)
);
CREATE INDEX generation_run_tenant_started_idx ON plataforma.generation_run (tenant_id, started_at DESC);

ALTER TABLE plataforma.generation_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.generation_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.generation_run AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id())
  WITH CHECK (tenant_id = plataforma.current_tenant_id());

REVOKE ALL ON TABLE plataforma.generation_run FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE plataforma.generation_run TO menlo_app;
