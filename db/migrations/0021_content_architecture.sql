-- 0021_content_architecture: arquitetura de conteúdo sobre o Page Factory existente. Reaproveita policy (política de links e perfis de densidade, versionadas e auditáveis), page_recipe, qa_report e page_approval.
-- Novas tabelas (todas do tenant, RLS forçada, só INSERT): cluster temático, arquitetura da página (por versão de recipe), grafo de links compilado (versão + arestas), resultado do Quality Gate de arquitetura e observação de indexação.
-- Estado efetivo de indexação é SÓ o observado (indexation_observation); elegibilidade para indexar é outra coisa e vive no resultado do gate.

CREATE TABLE plataforma.topic_cluster (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL REFERENCES plataforma.tenant (id),
  cluster_key  text        NOT NULL CHECK (length(cluster_key) BETWEEN 3 AND 300),
  name         text        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  archetype_id text        NOT NULL CHECK (archetype_id ~ '^T(0[1-9]|1[0-2])$'),
  primary_intent text      NOT NULL CHECK (length(primary_intent) BETWEEN 1 AND 200),
  domain       text        NOT NULL CHECK (length(domain) BETWEEN 1 AND 100),
  locale       text        NOT NULL CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  market       text        NOT NULL CHECK (length(market) BETWEEN 1 AND 20),
  scope        jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(scope) = 'object'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, cluster_key)
);

CREATE TABLE plataforma.page_architecture (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id          uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id     uuid        NOT NULL,
  recipe_id          uuid        NOT NULL,
  archetype_id       text        NOT NULL CHECK (archetype_id ~ '^T(0[1-9]|1[0-2])$'),
  contract_version   text        NOT NULL CHECK (contract_version ~ '^\d+\.\d+\.\d+$'),
  topic_cluster_id   uuid,
  primary_intent     text        NOT NULL CHECK (length(primary_intent) BETWEEN 1 AND 200),
  intent_evidence    jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(intent_evidence) = 'array'),
  primary_entity_id  uuid,
  domain             text        NOT NULL CHECK (length(domain) BETWEEN 1 AND 100),
  locale             text        NOT NULL CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  market             text        NOT NULL CHECK (length(market) BETWEEN 1 AND 20),
  canonical_url      text        CHECK (canonical_url IS NULL OR length(canonical_url) <= 500),
  canonical_rule     text        NOT NULL CHECK (canonical_rule IN ('self', 'parent', 'none')),
  template_contract_version text,
  created_by         text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, recipe_id) REFERENCES plataforma.page_recipe (tenant_id, id),
  FOREIGN KEY (tenant_id, topic_cluster_id) REFERENCES plataforma.topic_cluster (tenant_id, id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, recipe_id)
);
CREATE INDEX page_architecture_opp_idx ON plataforma.page_architecture (tenant_id, opportunity_id, seq DESC);
CREATE INDEX page_architecture_cluster_idx ON plataforma.page_architecture (tenant_id, topic_cluster_id);

CREATE TABLE plataforma.link_graph (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq            bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant (id),
  domain         text        NOT NULL CHECK (length(domain) BETWEEN 1 AND 100),
  content_hash   text        NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  policy_version text        NOT NULL,
  stats          jsonb       NOT NULL CHECK (jsonb_typeof(stats) = 'object'),
  created_by     text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, content_hash)
);

CREATE TABLE plataforma.link_edge (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES plataforma.tenant (id),
  graph_id        uuid        NOT NULL,
  from_opportunity_id uuid    NOT NULL,
  to_opportunity_id   uuid,
  to_path         text        NOT NULL CHECK (length(to_path) BETWEEN 1 AND 500),
  relation        text        NOT NULL CHECK (relation IN ('parent', 'child', 'region_to_city', 'city_to_neighborhood', 'destination_to_poi', 'category_to_entity', 'entity_to_experience', 'comparison_to_entity', 'cluster_to_page', 'complementary_intent', 'sibling', 'breadcrumb')),
  module_id       text,
  reason          text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  state           text        NOT NULL CHECK (state IN ('VALID', 'INVALID')),
  invalid_reason  text        CHECK (invalid_reason IS NULL OR invalid_reason IN ('SELF_LINK', 'DUPLICATE', 'DESTINATION_MISSING', 'NON_CANONICAL_DESTINATION', 'CONFLICTING_CANONICAL', 'SOURCE_INELIGIBLE', 'RELATION_NOT_ALLOWED', 'FORBIDDEN_DESTINATION')),
  evidence        jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence) = 'array'),
  FOREIGN KEY (tenant_id, graph_id) REFERENCES plataforma.link_graph (tenant_id, id),
  FOREIGN KEY (tenant_id, from_opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, to_opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  UNIQUE (tenant_id, id),
  CHECK ((state = 'VALID') = (invalid_reason IS NULL))
);
CREATE INDEX link_edge_to_idx ON plataforma.link_edge (tenant_id, graph_id, to_opportunity_id);
CREATE INDEX link_edge_from_idx ON plataforma.link_edge (tenant_id, graph_id, from_opportunity_id);

CREATE TABLE plataforma.quality_gate_result (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq                 bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id           uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id      uuid        NOT NULL,
  recipe_id           uuid        NOT NULL,
  archetype_id        text        NOT NULL CHECK (archetype_id ~ '^T(0[1-9]|1[0-2])$'),
  contract_version    text        NOT NULL,
  graph_id            uuid,
  input_hash          text        NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  result              jsonb       NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  quality_score       numeric(5,4) CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 1),
  eligible_approval   boolean     NOT NULL,
  eligible_publication boolean    NOT NULL,
  eligible_indexing   boolean     NOT NULL,
  failed_rules        jsonb       NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(failed_rules) = 'array'),
  created_by          text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  FOREIGN KEY (tenant_id, recipe_id) REFERENCES plataforma.page_recipe (tenant_id, id),
  FOREIGN KEY (tenant_id, graph_id) REFERENCES plataforma.link_graph (tenant_id, id),
  UNIQUE (tenant_id, id),
  -- publicar exige poder aprovar; indexar exige poder publicar (níveis encadeados, nunca invertidos)
  CHECK ((NOT eligible_publication OR eligible_approval) AND (NOT eligible_indexing OR eligible_publication))
);
CREATE INDEX quality_gate_result_recipe_idx ON plataforma.quality_gate_result (tenant_id, recipe_id, seq DESC);
CREATE INDEX quality_gate_result_opp_idx ON plataforma.quality_gate_result (tenant_id, opportunity_id, seq DESC);

-- Estado de indexação OBSERVADO (Search Console ou inspeção manual): nunca deduzido de aprovação, deployment ou resultado do gate.
CREATE TABLE plataforma.indexation_observation (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  seq            bigint      GENERATED ALWAYS AS IDENTITY,
  tenant_id      uuid        NOT NULL REFERENCES plataforma.tenant (id),
  opportunity_id uuid        NOT NULL,
  url            text        NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 1000),
  state          text        NOT NULL CHECK (state IN ('INDEXED', 'NOT_INDEXED', 'DISCOVERED_NOT_INDEXED', 'CRAWLED_NOT_INDEXED', 'BLOCKED_BY_ROBOTS', 'EXCLUDED_BY_NOINDEX', 'CANONICAL_ELSEWHERE', 'ERROR')),
  source         text        NOT NULL CHECK (source IN ('search_console', 'manual_inspection')),
  observed_at    timestamptz NOT NULL,
  evidence       jsonb       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(evidence) = 'object'),
  created_by     text        NOT NULL CHECK (length(created_by) BETWEEN 1 AND 200),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES plataforma.growth_opportunity (tenant_id, id),
  UNIQUE (tenant_id, id),
  CHECK (observed_at <= created_at + interval '1 minute')
);
CREATE INDEX indexation_observation_idx ON plataforma.indexation_observation (tenant_id, opportunity_id, observed_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['topic_cluster', 'page_architecture', 'link_graph', 'link_edge', 'quality_gate_result', 'indexation_observation'] LOOP
    EXECUTE format('ALTER TABLE plataforma.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE plataforma.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON plataforma.%I AS PERMISSIVE FOR ALL TO menlo_app USING (tenant_id = plataforma.current_tenant_id()) WITH CHECK (tenant_id = plataforma.current_tenant_id())', t);
    EXECUTE format('REVOKE ALL ON TABLE plataforma.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE plataforma.%I TO menlo_app', t);
  END LOOP;
END $$;
