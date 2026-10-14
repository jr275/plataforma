-- 0010_page_draft: rascunho do editor visual de experiência de página (ADR-026). Uma tabela do tenant, histórico imutável (a aplicação só lê e insere): cada salvamento é
-- uma VERSÃO nova (único por conteúdo: salvar o mesmo conteúdo não cria versão). Guarda o modelo de domínio (nós, arestas, posições), a validação e o resultado dos gates
-- avaliados sobre o rascunho, e o resumo das mudanças relevantes. Salvar NÃO gera, indexa nem publica página nenhuma.

CREATE TABLE plataforma.page_draft (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id         uuid        NOT NULL,
  version                integer     NOT NULL CHECK (version >= 1),
  base_blueprint_version integer     NOT NULL CHECK (base_blueprint_version >= 1),
  content                jsonb       NOT NULL CHECK (jsonb_typeof(content) = 'object' AND content->>'schema' = 'page-draft/v1'),
  content_sha            text        NOT NULL CHECK (content_sha ~ '^[0-9a-f]{64}$'),
  content_sig            text        NOT NULL CHECK (length(content_sig) BETWEEN 1 AND 64),
  validation             jsonb       NOT NULL CHECK (jsonb_typeof(validation) = 'object'),
  gates                  jsonb       NOT NULL CHECK (jsonb_typeof(gates) = 'array' AND jsonb_array_length(gates) = 6),
  valid                  boolean     NOT NULL,
  errors                 integer     NOT NULL CHECK (errors >= 0),
  warnings               integer     NOT NULL CHECK (warnings >= 0),
  changes                jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(changes) = 'array'),
  note                   text        CHECK (note IS NULL OR length(note) <= 300),
  created_by             text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, opportunity_id, version),
  UNIQUE (tenant_id, opportunity_id, content_sha),
  CHECK (valid = (errors = 0))
);
CREATE INDEX page_draft_latest_idx ON plataforma.page_draft (tenant_id, opportunity_id, version DESC);

ALTER TABLE plataforma.page_draft ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.page_draft FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.page_draft AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id());

REVOKE ALL ON TABLE plataforma.page_draft FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE plataforma.page_draft TO menlo_app;
