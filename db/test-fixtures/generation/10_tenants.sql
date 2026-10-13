-- SEED DE TESTE (nunca é migration; ADR-013, item 3). Dois tenants EXCLUSIVOS dos testes de geração de páginas, para não se misturarem
-- com os dados dos testes de importação (tenants A e B de 10_seed.sql). Roda como superusuário do cluster DESCARTÁVEL.
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'geracao-c', 'Geração C'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'geracao-d', 'Geração D');
