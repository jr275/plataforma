-- 0006_page: página lógica (uma por entidade), histórico IMUTÁVEL de versões e um registro por entidade tentada em cada execução
-- (ADR-020). `page_version` guarda só conteúdo que passou em todos os gates; tentativas reprovadas ficam em `generation_item.gates`.
-- A URL (`path`) é única por tenant: a mesma cidade nunca gera duas URLs. Sem DELETE para a aplicação.

CREATE TABLE plataforma.page (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant (id),
  entity_kind    text        NOT NULL CHECK (entity_kind IN ('city')),
  entity_id      uuid        NOT NULL,
  path           text        NOT NULL CHECK (path ~ '^/[a-z0-9/-]{1,200}$'),
  latest_version integer     NOT NULL CHECK (latest_version >= 1),
  status         text        NOT NULL CHECK (status IN ('draft', 'blocked')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES plataforma.city (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, path),
  UNIQUE (tenant_id, entity_kind, entity_id)
);
CREATE TRIGGER page_set_updated_at BEFORE UPDATE ON plataforma.page
  FOR EACH ROW EXECUTE FUNCTION plataforma.set_updated_at();

CREATE TABLE plataforma.page_version (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  page_id          uuid        NOT NULL,
  version          integer     NOT NULL CHECK (version >= 1),
  run_id           uuid        NOT NULL,
  content          jsonb       NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_hash     text        NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  template_key     text        NOT NULL,
  template_version integer     NOT NULL CHECK (template_version >= 1),
  template_hash    text        NOT NULL CHECK (template_hash ~ '^[0-9a-f]{64}$'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, page_id) REFERENCES plataforma.page (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES plataforma.generation_run (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (page_id, version)
);
CREATE INDEX page_version_page_idx ON plataforma.page_version (tenant_id, page_id, version DESC);

CREATE TABLE plataforma.generation_item (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES plataforma.tenant (id),
  run_id          uuid        NOT NULL,
  entity_id       uuid        NOT NULL,
  outcome         text        NOT NULL CHECK (outcome IN ('generated', 'unchanged', 'blocked')),
  gates           jsonb       NOT NULL CHECK (jsonb_typeof(gates) = 'array' AND jsonb_array_length(gates) = 6),
  page_id         uuid,
  page_version_id uuid,
  error           text        CHECK (error IS NULL OR length(error) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, run_id) REFERENCES plataforma.generation_run (tenant_id, id),
  FOREIGN KEY (tenant_id, entity_id) REFERENCES plataforma.city (tenant_id, id),
  FOREIGN KEY (tenant_id, page_id) REFERENCES plataforma.page (tenant_id, id),
  FOREIGN KEY (tenant_id, page_version_id) REFERENCES plataforma.page_version (tenant_id, id),
  UNIQUE (run_id, entity_id),
  CHECK (outcome <> 'generated' OR page_version_id IS NOT NULL)
);
CREATE INDEX generation_item_run_idx ON plataforma.generation_item (tenant_id, run_id, outcome);

ALTER TABLE plataforma.page ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.page FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.page AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());
ALTER TABLE plataforma.page_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.page_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.page_version AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());
ALTER TABLE plataforma.generation_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.generation_item FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.generation_item AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());

REVOKE ALL ON TABLE plataforma.page, plataforma.page_version, plataforma.generation_item FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE plataforma.page TO menlo_app;
GRANT SELECT, INSERT ON TABLE plataforma.page_version, plataforma.generation_item TO menlo_app;
