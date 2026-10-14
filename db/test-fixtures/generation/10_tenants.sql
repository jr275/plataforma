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
-- Tenants K e L: testes de busca e detalhe de cidades (entidades reais e proveniência da importação, isolamento entre tenants).
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('f7777777-7777-4777-8777-777777777777', 'cidades-k', 'Cidades K'),
  ('f8888888-8888-4888-8888-888888888888', 'cidades-l', 'Cidades L');
-- Tenant M: amostra multi-UF (cidades-amostra.csv, com linha duplicada e rejeitadas) para as contagens de relação e a população ausente.
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('f9999999-9999-4999-8999-999999999999', 'cidades-m', 'Cidades M');
-- Tenants N e O: testes do grafo de conhecimento (nós, relações, expansão, isolamento e conformância SQL x memória).
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('fa111111-1111-4111-8111-111111111111', 'grafo-n', 'Grafo N'),
  ('fa222222-2222-4222-8222-222222222222', 'grafo-o', 'Grafo O');
-- Tenants P e Q: testes do motor de oportunidades (pesquisa, persistência idempotente, score, ciclo de vida e isolamento entre tenants).
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('fb111111-1111-4111-8111-111111111111', 'motor-p', 'Motor P'),
  ('fb222222-2222-4222-8222-222222222222', 'motor-q', 'Motor Q');
-- Tenant R: testes de blueprint, gates de experiência e roadmap (ADR-024).
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('fb333333-3333-4333-8333-333333333333', 'motor-r', 'Motor R');
-- Tenants S e T: testes do rascunho do editor de experiência de página (persistência, versões, isolamento entre tenants).
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('fb444444-4444-4444-8444-444444444444', 'editor-s', 'Editor S'),
  ('fb555555-5555-4555-8555-555555555555', 'editor-t', 'Editor T');
-- Tenants U e V: testes dos dados de provedores (cache, custo, sinais, SERP e concorrentes; ADR-027).
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('fb666666-6666-4666-8666-666666666666', 'provedor-u', 'Provedor U'),
  ('fb777777-7777-4777-8777-777777777777', 'provedor-v', 'Provedor V');
-- Tenants W e X: testes da geração a partir do blueprint (ligação oportunidade-página, avanço até QA, bloqueio da publicação; ADR-028).
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('fb888888-8888-4888-8888-888888888888', 'blueprint-w', 'Blueprint W'),
  ('fb999999-9999-4999-8999-999999999999', 'blueprint-x', 'Blueprint X');
-- Tenants Y e Z: testes da camada de dados (entidade, fato bi-temporal, catálogo de atributos; ADR-029).
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('fc111111-1111-4111-8111-111111111111', 'catalogo-y', 'Catálogo Y'),
  ('fc222222-2222-4222-8222-222222222222', 'catalogo-z', 'Catálogo Z');
-- Tenants A2, B2 e C2 (fd...): motor de tópicos, combinações e decisões (ADR-030 em diante).
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('fd111111-1111-4111-8111-111111111111', 'topicos-1', 'Tópicos 1'),
  ('fd222222-2222-4222-8222-222222222222', 'topicos-2', 'Tópicos 2'),
  ('fd333333-3333-4333-8333-333333333333', 'topicos-3', 'Tópicos 3'),
  ('fd444444-4444-4444-8444-444444444444', 'topicos-4', 'Tópicos 4'),
  ('fd555555-5555-4555-8555-555555555555', 'topicos-5', 'Tópicos 5'),
  ('fd666666-6666-4666-8666-666666666666', 'topicos-6', 'Tópicos 6'),
  ('fd777777-7777-4777-8777-777777777777', 'topicos-7', 'Tópicos 7'),
  ('fd888888-8888-4888-8888-888888888888', 'topicos-8', 'Tópicos 8'),
  ('fe111111-1111-4111-8111-111111111111', 'blueprint-i', 'Blueprint I'),
  ('fe222222-2222-4222-8222-222222222222', 'blueprint-j', 'Blueprint J'),
  ('fe333333-3333-4333-8333-333333333333', 'recipe-k', 'Recipe K'),
  ('fe444444-4444-4444-8444-444444444444', 'recipe-l', 'Recipe L'),
  ('fe555555-5555-4555-8555-555555555555', 'runtime-m', 'Runtime M'),
  ('fe666666-6666-4666-8666-666666666666', 'runtime-n', 'Runtime N'),
  ('fe777777-7777-4777-8777-777777777777', 'factory-o', 'Factory O'),
  ('fe888888-8888-4888-8888-888888888888', 'factory-p', 'Factory P');
