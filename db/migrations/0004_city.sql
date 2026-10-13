-- 0004_city: primeiro fato real do produto (ADR-017). Cidade identificada pelo código IBGE de 7 dígitos, único por tenant;
-- reimportar atualiza, não duplica. `source_run_id` liga a cidade à execução que a gravou (rastreabilidade).
-- Núcleo genérico (regra 10): "cidade" é uma entidade geográfica, não um termo de imóveis.

CREATE TABLE plataforma.city (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES plataforma.tenant (id),
  ibge_code       text        NOT NULL CHECK (ibge_code ~ '^[0-9]{7}$'),
  name            text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  uf              text        NOT NULL CHECK (uf IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')),
  region          text        CHECK (region IN ('Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul')),
  population      bigint      CHECK (population >= 0),
  population_year smallint    CHECK (population_year BETWEEN 1900 AND 2200),
  source_run_id   uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, source_run_id) REFERENCES plataforma.import_run (tenant_id, id),
  UNIQUE (tenant_id, ibge_code),
  UNIQUE (tenant_id, id)
);
CREATE INDEX city_tenant_uf_name_idx ON plataforma.city (tenant_id, uf, name);

CREATE TRIGGER city_set_updated_at BEFORE UPDATE ON plataforma.city
  FOR EACH ROW EXECUTE FUNCTION plataforma.set_updated_at();

ALTER TABLE plataforma.city ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.city FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON plataforma.city AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = plataforma.current_tenant_id())
  WITH CHECK (tenant_id = plataforma.current_tenant_id());

REVOKE ALL ON TABLE plataforma.city FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE plataforma.city TO menlo_app;
