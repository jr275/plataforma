-- SEED DE TESTE (nunca é migration; ADR-013, item 3). Roda como o superusuário do cluster DESCARTÁVEL, que ignora o RLS.
-- Dois tenants sem sobreposição, para provar o isolamento.
INSERT INTO plataforma.tenant (id, slug, name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tenant-a', 'Tenant A'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'tenant-b', 'Tenant B');

INSERT INTO plataforma.opportunity (id, tenant_id, title, summary, next_action, kind, intent, demand, competition, evidence, status, rank, rationale, gaps) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A: guia de compra', 'Resumo A1', 'Revisar', 'page', 'informational', 'high', 'medium', 'high', 'in_review', 1, ARRAY['motivo 1', 'motivo 2'], ARRAY['lacuna 1']),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A: comparativo', 'Resumo A2', 'Definir critérios', 'comparison', 'comparison', 'medium', 'high', 'medium', 'candidate', 2, '{}', '{}'),
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A: FAQ descartada', 'Resumo A3', 'Nada', 'faq', 'informational', 'low', 'low', 'low', 'dismissed', 3, '{}', '{}'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B: documentação', 'Resumo B1', 'Rodar gates', 'page', 'informational', 'high', 'low', 'high', 'ready', 1, ARRAY['motivo B'], '{}'),
  ('b0000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B: cluster', 'Resumo B2', 'Mapear', 'cluster', 'transactional', 'medium', 'medium', 'medium', 'blocked', 2, '{}', ARRAY['lacuna B']);
