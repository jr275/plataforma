-- 0009_page_blueprint: blueprint de página e resultado dos gates de experiência (ADR-024). Uma tabela do tenant, histórico imutável (a aplicação só lê e insere).
-- Cada versão é única por conteúdo: repetir o mesmo blueprint não cria versão nova. Não há tabela de roadmap: ele é uma leitura derivada.

CREATE TABLE plataforma.page_blueprint (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id   uuid        NOT NULL,
  version          integer     NOT NULL CHECK (version >= 1),
  content          jsonb       NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_hash     text        NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  template_key     text        CHECK (template_key IS NULL OR length(template_key) BETWEEN 1 AND 80),
  template_version integer     CHECK (template_version IS NULL OR template_version >= 1),
  ready            boolean     NOT NULL,
  gates            jsonb       NOT NULL CHECK (jsonb_typeof(gates) = 'array' AND jsonb_array_length(gates) = 6),
  blockers         jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(blockers) = 'array'),
  created_by       text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, opportunity_id, version),
  UNIQUE (tenant_id, opportunity_id, content_hash),
  CHECK ((template_key IS NULL) = (template_version IS NULL)),
  CHECK (NOT ready OR template_key IS NOT NULL)
);
CREATE INDEX page_blueprint_latest_idx ON plataforma.page_blueprint (tenant_id, opportunity_id, version DESC);

ALTER TABLE plataforma.page_blueprint ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.page_blueprint FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.page_blueprint AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());

REVOKE ALL ON TABLE plataforma.page_blueprint FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE plataforma.page_blueprint TO menlo_app;
