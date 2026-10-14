-- 0014_topic: o TÓPICO da especificação (seção 4.5) é uma `growth_opportunity` ampliada, para reaproveitar o ciclo de vida, o blueprint e a geração existentes (ADR-030).
-- Colunas novas são opcionais: as hipóteses do motor anterior continuam válidas. Um tópico tem `topic_id` (hash determinístico das dimensões normalizadas, único por tenant).
ALTER TABLE plataforma.growth_opportunity
  ADD COLUMN topic_id              text,
  ADD COLUMN primary_entity_id     uuid,
  ADD COLUMN dimensions            jsonb,
  ADD COLUMN attributes_used       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN relationships_used    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN data_available        text[] NOT NULL DEFAULT '{}',
  ADD COLUMN data_missing          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN evidence_required     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN candidate_page_family text,
  ADD COLUMN parent_topic_id       text,
  ADD COLUMN geo_granularity       text CHECK (geo_granularity IS NULL OR geo_granularity IN ('property', 'street', 'neighborhood', 'city', 'region')),
  ADD COLUMN topic_origin          text CHECK (topic_origin IS NULL OR topic_origin IN ('ATTRIBUTE', 'RELATIONSHIP', 'COMBINATION', 'DEMAND_DATA', 'GAP_ANALYSIS')),
  ADD COLUMN intent_type           text CHECK (intent_type IS NULL OR intent_type IN ('transactional', 'commercial', 'informational', 'local', 'comparative', 'seasonal', 'question')),
  ADD COLUMN commercial_potential  text CHECK (commercial_potential IS NULL OR commercial_potential IN ('high', 'medium', 'low', 'none')),
  ADD COLUMN user_need             text CHECK (user_need IS NULL OR length(user_need) <= 500),
  ADD COLUMN demand_signal         jsonb CHECK (demand_signal IS NULL OR jsonb_typeof(demand_signal) = 'object'),
  ADD COLUMN differentiation       text CHECK (differentiation IS NULL OR length(differentiation) <= 1000),
  ADD FOREIGN KEY (tenant_id, primary_entity_id) REFERENCES plataforma.entity (tenant_id, id),
  ADD CONSTRAINT growth_opportunity_topic_shape CHECK (topic_id IS NULL OR (topic_id ~ '^[0-9a-f]{64}$' AND dimensions IS NOT NULL AND jsonb_typeof(dimensions) = 'object' AND topic_origin IS NOT NULL AND candidate_page_family IS NOT NULL AND intent_type IS NOT NULL));
CREATE UNIQUE INDEX growth_opportunity_topic_idx ON plataforma.growth_opportunity (tenant_id, topic_id) WHERE topic_id IS NOT NULL;
CREATE INDEX growth_opportunity_topic_parent_idx ON plataforma.growth_opportunity (tenant_id, parent_topic_id) WHERE parent_topic_id IS NOT NULL;
CREATE INDEX growth_opportunity_topic_family_idx ON plataforma.growth_opportunity (tenant_id, candidate_page_family) WHERE topic_id IS NOT NULL;
