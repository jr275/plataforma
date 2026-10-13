-- SEED DE TESTE (nunca é migration; ADR-013, item 3). Dois tenants EXCLUSIVOS dos testes de geração de páginas, para não se misturarem
-- com os dados dos testes de importação (tenants A e B de 10_seed.sql). Roda como superusuário do cluster DESCARTÁVEL.
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'geracao-c', 'Geração C'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'geracao-d', 'Geração D');
-- Tenants E e F: testes de segurança da geração (ids inexistentes, execução abandonada, concorrência e isolamento entre tenants).
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('f1111111-1111-4111-8111-111111111111', 'geracao-e', 'Geração E'),
  ('f2222222-2222-4222-8222-222222222222', 'geracao-f', 'Geração F');
-- Tenants G e H: testes das consultas da interface (busca, detalhe, isolamento).
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('f3333333-3333-4333-8333-333333333333', 'geracao-g', 'Geração G'),
  ('f4444444-4444-4444-8444-444444444444', 'geracao-h', 'Geração H');
-- Tenants I e J: testes de reprocessamento de uma página (escopo autorizado, histórico, falhas explícitas, sem publicação implícita).
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('f5555555-5555-4555-8555-555555555555', 'geracao-i', 'Geração I'),
  ('f6666666-6666-4666-8666-666666666666', 'geracao-j', 'Geração J');
