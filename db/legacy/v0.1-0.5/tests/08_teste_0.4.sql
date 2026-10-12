BEGIN;
SET search_path = menlo, public;
INSERT INTO tenant (id, slug, name) VALUES ('00000000-0000-0000-0000-000000000008','t4','Teste 0.4');
SELECT set_config('menlo.tenant_id','00000000-0000-0000-0000-000000000008', true);
INSERT INTO entity_type (tenant_id, code, label) VALUES ('00000000-0000-0000-0000-000000000008','city','Cidade');
INSERT INTO entity (id, tenant_id, entity_type, canonical_key, name) VALUES
 ('00000000-0000-0000-0000-0000000000c8','00000000-0000-0000-0000-000000000008','city','sp/x','X');
-- T1: page_type inválido é rejeitado
DO $$ BEGIN
  BEGIN
    INSERT INTO template (tenant_id, code, version, contract, page_type) VALUES ('00000000-0000-0000-0000-000000000008','t',1,'{}','landing');
    RAISE EXCEPTION 'T1 FALHOU: aceitou page_type inválido';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE 'T1 ok: page_type inválido rejeitado'; END;
END $$;
INSERT INTO template (tenant_id, code, version, contract, page_type) VALUES ('00000000-0000-0000-0000-000000000008','t',1,'{}','location');
-- T2: semana com 2 dias (seg 2026-10-05 e ter 06), 2 páginas na mesma cidade, soma correta, dias_na_semana = 2
INSERT INTO observation (tenant_id, city_entity_id, metric, value, period_start, period_end, dimensions) VALUES
 ('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-0000000000c8','gsc_clicks',10,'2026-10-05','2026-10-05','{"page":"/a","query_class":"nonbrand"}'),
 ('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-0000000000c8','gsc_clicks',5,'2026-10-05','2026-10-05','{"page":"/b","query_class":"nonbrand"}'),
 ('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-0000000000c8','gsc_clicks',7,'2026-10-06','2026-10-06','{"page":"/a","query_class":"nonbrand"}'),
 ('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-0000000000c8','gsc_clicks',99,'2026-10-05','2026-10-05','{"page":"/a","query_class":"brand"}'),
 ('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-0000000000c8','gsc_clicks',500,'2026-07-07','2026-10-06','{"page":"/a","query_class":"all","grain":"period"}');
DO $$ DECLARE c numeric; d int; BEGIN
  SELECT clicks, dias_na_semana INTO c, d FROM v_city_week_nonbrand WHERE week_start='2026-10-05';
  IF c = 22 AND d = 2 THEN RAISE NOTICE 'T2 ok: semana soma 22 cliques sem marca em 2 dias (marca e período agregado ficam de fora)';
  ELSE RAISE EXCEPTION 'T2 FALHOU: clicks=% dias=%', c, d; END IF;
END $$;
-- T3: recarga duplicada é bloqueada
DO $$ BEGIN
  BEGIN
    INSERT INTO observation (tenant_id, city_entity_id, metric, value, period_start, period_end, dimensions)
    VALUES ('00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-0000000000c8','gsc_clicks',10,'2026-10-05','2026-10-05','{"page":"/a","query_class":"nonbrand"}');
    RAISE EXCEPTION 'T3 FALHOU: aceitou duplicata';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'T3 ok: duplicata bloqueada'; END;
END $$;
-- T4: reconciliação: total 130 = marca 99 + sem marca 22 -> diferença 9 (detecta falta)
INSERT INTO observation (tenant_id, metric, value, period_start, period_end, dimensions) VALUES
 ('00000000-0000-0000-0000-000000000008','gsc_clicks',130,'2026-10-05','2026-10-05','{"query_class":"all"}'),
 ('00000000-0000-0000-0000-000000000008','gsc_clicks',99,'2026-10-05','2026-10-05','{"query_class":"brand"}');
DO $$ DECLARE df numeric; BEGIN
  SELECT diferenca INTO df FROM v_gsc_reconciliation WHERE dia='2026-10-05';
  IF df = 16 THEN RAISE NOTICE 'T4 ok: diferença de reconciliação calculada (130-99-15=16)';
  ELSE RAISE EXCEPTION 'T4 FALHOU: diferenca=%', df; END IF;
END $$;
ROLLBACK;
