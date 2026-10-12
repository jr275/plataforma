-- Extensões opcionais. Requerem PostGIS e pgvector instalados (disponíveis no Neon).
-- NÃO testado no ambiente de desenvolvimento desta entrega (as extensões não estavam instaladas).
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
SET search_path = menlo, public;

-- Localização geográfica da entidade (imóveis, bairros, estações, pontos de interesse).
ALTER TABLE entity ADD COLUMN IF NOT EXISTS geo geography(Point, 4326);
CREATE INDEX IF NOT EXISTS entity_geo_idx ON entity USING gist (geo);

-- Vetores para busca semântica (resolução de entidades, perguntas parecidas). Dimensão ajustável.
CREATE TABLE IF NOT EXISTS entity_embedding (
  entity_id  uuid PRIMARY KEY REFERENCES entity(id),
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  model      text NOT NULL,
  embedding  vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entity_embedding_idx ON entity_embedding USING hnsw (embedding vector_cosine_ops);
