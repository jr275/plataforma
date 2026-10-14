-- 0013_entity_fact_catalog: camada de dados do motor de páginas (ADR-029). Cinco tabelas do tenant: política versionada, entidade genérica, fato com proveniência obrigatória (bi-temporal,
-- append-only), execução do catálogo de atributos e o catálogo por atributo. Nenhum dado é semeado. Regras: R1 (sem fato sem fonte e data), R12 (ausência = sem linha, nunca valor inventado).

CREATE TABLE plataforma.policy (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES plataforma.tenant (id),
  kind         text        NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_]{2,40}$'),
  version      integer     NOT NULL CHECK (version >= 1),
  content      jsonb       NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_hash text        NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  note         text        CHECK (note IS NULL OR length(note) <= 500),
  created_by   text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, kind, version),
  UNIQUE (tenant_id, kind, content_hash)
);

CREATE TABLE plataforma.entity (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES plataforma.tenant (id),
  entity_type           text        NOT NULL CHECK (entity_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- chave estável da entidade NA FONTE (ex.: "ibge:3550308"); nunca reutilizada
  source_key            text        NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  name                  text        NOT NULL CHECK (length(name) BETWEEN 1 AND 300),
  aliases               text[]      NOT NULL DEFAULT '{}' CHECK (cardinality(aliases) <= 50),
  geometry              jsonb       CHECK (geometry IS NULL OR jsonb_typeof(geometry) = 'object'),
  parent_ids            uuid[]      NOT NULL DEFAULT '{}' CHECK (cardinality(parent_ids) <= 20),
  external_ids          jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(external_ids) = 'object'),
  resolution_confidence numeric(4,3) NOT NULL DEFAULT 1 CHECK (resolution_confidence BETWEEN 0 AND 1),
  status                text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'MERGED', 'DEPRECATED')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, entity_type, source_key)
);
CREATE INDEX entity_type_idx ON plataforma.entity (tenant_id, entity_type, status);
CREATE TRIGGER entity_set_updated_at BEFORE UPDATE ON plataforma.entity FOR EACH ROW EXECUTE FUNCTION plataforma.set_updated_at();

CREATE TABLE plataforma.fact (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES plataforma.tenant (id),
  entity_id             uuid        NOT NULL,
  attribute_id          text        NOT NULL CHECK (attribute_id ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  value                 jsonb       NOT NULL,
  unit                  text        CHECK (unit IS NULL OR length(unit) BETWEEN 1 AND 40),
  -- R1: toda afirmação tem fonte, data observada e confiança
  source_name           text        NOT NULL CHECK (length(btrim(source_name)) BETWEEN 1 AND 200),
  source_url            text        CHECK (source_url IS NULL OR (source_url ~ '^https?://' AND length(source_url) <= 2000)),
  source_license        text        CHECK (source_license IS NULL OR length(source_license) <= 200),
  observed_at           timestamptz NOT NULL,
  -- quando a fonte só informa o ano (ou o mês), a data é o início do período e a precisão diz isso
  observed_precision    text        NOT NULL DEFAULT 'day' CHECK (observed_precision IN ('day', 'month', 'year')),
  ingested_at           timestamptz NOT NULL,
  confidence            numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  geospatial_precision  text        CHECK (geospatial_precision IS NULL OR geospatial_precision IN ('exact', 'street', 'neighborhood', 'city')),
  import_run_id         uuid,
  provider_call_id      uuid,
  content_hash          text        NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  -- tempo de TRANSAÇÃO: a versão corrente tem NULL; corrigir um fato fecha a versão antiga (nunca apaga)
  superseded_at         timestamptz,
  FOREIGN KEY (tenant_id, entity_id) REFERENCES plataforma.entity (tenant_id, id),
  FOREIGN KEY (tenant_id, import_run_id) REFERENCES plataforma.import_run (tenant_id, id),
  FOREIGN KEY (tenant_id, provider_call_id) REFERENCES plataforma.provider_call (tenant_id, id),
  UNIQUE (tenant_id, id),
  CHECK (superseded_at IS NULL OR superseded_at >= ingested_at)
);
-- no máximo UMA versão corrente por (entidade, atributo)
CREATE UNIQUE INDEX fact_current_idx ON plataforma.fact (tenant_id, entity_id, attribute_id) WHERE superseded_at IS NULL;
CREATE INDEX fact_attribute_idx ON plataforma.fact (tenant_id, attribute_id) WHERE superseded_at IS NULL;

-- a única mutação permitida: fechar a versão corrente (superseded_at: NULL → valor)
CREATE FUNCTION plataforma.fact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL THEN
    RAISE EXCEPTION 'um fato só pode ser encerrado uma vez (superseded_at: NULL -> valor)' USING ERRCODE = '23514';
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.entity_id, NEW.attribute_id, NEW.value, NEW.source_name, NEW.observed_at, NEW.content_hash)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.entity_id, OLD.attribute_id, OLD.value, OLD.source_name, OLD.observed_at, OLD.content_hash) THEN
    RAISE EXCEPTION 'um fato é imutável: só superseded_at pode mudar' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fact_guard BEFORE UPDATE ON plataforma.fact FOR EACH ROW EXECUTE FUNCTION plataforma.fact_guard();

CREATE TABLE plataforma.catalog_run (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES plataforma.tenant (id),
  policy_id   uuid        NOT NULL,
  -- mesmo conjunto de fatos + mesma política + mesmo dia = mesma execução (idempotência)
  inputs_hash text        NOT NULL CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
  computed_at timestamptz NOT NULL,
  stats       jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(stats) = 'object'),
  created_by  text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  FOREIGN KEY (tenant_id, policy_id) REFERENCES plataforma.policy (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, inputs_hash)
);

CREATE TABLE plataforma.attribute_catalog (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL REFERENCES plataforma.tenant (id),
  catalog_run_id        uuid        NOT NULL,
  attribute_id          text        NOT NULL,
  entity_type           text        NOT NULL,
  attribute_name        text        NOT NULL CHECK (length(attribute_name) BETWEEN 1 AND 200),
  data_type             text        NOT NULL CHECK (data_type IN ('numeric', 'categorical', 'geographic', 'temporal', 'relational', 'derived', 'contextual', 'commercial', 'semantic', 'qualitative')),
  origin                text        NOT NULL CHECK (origin IN ('OBSERVED', 'DERIVED', 'INFERRED')),
  semantic_category     text        NOT NULL,
  source                text        NOT NULL,
  source_quality        numeric(4,3) CHECK (source_quality IS NULL OR source_quality BETWEEN 0 AND 1),
  entities_total        integer     NOT NULL CHECK (entities_total >= 0),
  entities_with_value   integer     NOT NULL CHECK (entities_with_value >= 0),
  -- cobertura NULL = não há entidades do tipo (não existe o que medir); 0 = existem entidades e nenhuma tem o atributo
  coverage              numeric(5,4) CHECK (coverage IS NULL OR coverage BETWEEN 0 AND 1),
  freshness_days        integer     CHECK (freshness_days IS NULL OR freshness_days >= 0),
  confidence            numeric(4,3) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  distribution          jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(distribution) = 'object'),
  derivation_method     text,
  related_entities      text[]      NOT NULL DEFAULT '{}',
  supported_intents     text[]      NOT NULL DEFAULT '{}',
  potential_page_families text[]    NOT NULL DEFAULT '{}',
  usable_as_fact        boolean     NOT NULL,
  validation_status     text        NOT NULL CHECK (validation_status IN ('VALID', 'PARTIAL', 'DATA_PENDING', 'INVALID')),
  reasons               jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(reasons) = 'array'),
  FOREIGN KEY (tenant_id, catalog_run_id) REFERENCES plataforma.catalog_run (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (catalog_run_id, attribute_id),
  CHECK (entities_with_value <= entities_total),
  CHECK (entities_total > 0 OR coverage IS NULL),
  CHECK (validation_status <> 'VALID' OR (coverage IS NOT NULL AND entities_with_value > 0))
);
CREATE INDEX attribute_catalog_run_idx ON plataforma.attribute_catalog (tenant_id, catalog_run_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['policy', 'entity', 'fact', 'catalog_run', 'attribute_catalog'] LOOP
    EXECUTE format('ALTER TABLE plataforma.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE plataforma.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON plataforma.%I AS PERMISSIVE FOR ALL TO menlo_app USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id())', t);
    EXECUTE format('REVOKE ALL ON TABLE plataforma.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE plataforma.%I TO menlo_app', t);
  END LOOP;
END $$;
-- mutações permitidas: encerrar a versão corrente de um fato; mudar o status/aliases/confiança de resolução de uma entidade
GRANT UPDATE (superseded_at) ON TABLE plataforma.fact TO menlo_app;
GRANT UPDATE (status, aliases, resolution_confidence, parent_ids, updated_at) ON TABLE plataforma.entity TO menlo_app;
