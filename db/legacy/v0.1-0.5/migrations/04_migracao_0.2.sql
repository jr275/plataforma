-- Migração 0.1 -> 0.2: liga cada padrão de demanda a uma entidade (necessário ao Opportunity Engine).
SET search_path = menlo, public;
ALTER TABLE demand_pattern ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES entity(id);
CREATE INDEX IF NOT EXISTS demand_pattern_entity_idx ON demand_pattern (tenant_id, market_id, entity_id);
