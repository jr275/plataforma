BEGIN;
SET search_path = menlo, public;
INSERT INTO tenant (id, slug, name) VALUES ('00000000-0000-0000-0000-000000000009','t3','Teste 0.3');
SELECT set_config('menlo.tenant_id','00000000-0000-0000-0000-000000000009', true);
INSERT INTO market (id, tenant_id, code, country_code, default_locale) VALUES
 ('00000000-0000-0000-0000-0000000000a9','00000000-0000-0000-0000-000000000009','br','BR','pt-BR');
INSERT INTO source (id, tenant_id, name, kind) VALUES ('00000000-0000-0000-0000-0000000000b9','00000000-0000-0000-0000-000000000009','feed','first_party_feed');
INSERT INTO source_usage_policy (tenant_id, source_id, allowed_uses, legal_status)
 VALUES ('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000b9','{display_on_page}','approved');
INSERT INTO entity_type (tenant_id, code, label) VALUES ('00000000-0000-0000-0000-000000000009','neighborhood','Bairro');
INSERT INTO entity (id, tenant_id, entity_type, canonical_key, name) VALUES
 ('00000000-0000-0000-0000-0000000000c9','00000000-0000-0000-0000-000000000009','neighborhood','b1','B1'),
 ('00000000-0000-0000-0000-0000000000ca','00000000-0000-0000-0000-000000000009','neighborhood','b2','B2');
INSERT INTO claim (id, tenant_id, entity_id, attribute_key, value, claim_class, source_id, observed_at) VALUES
 ('00000000-0000-0000-0000-0000000000d9','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000c9','pop','1','VERIFIED','00000000-0000-0000-0000-0000000000b9',now()),
 ('00000000-0000-0000-0000-0000000000da','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000c9','price','2','VERIFIED','00000000-0000-0000-0000-0000000000b9',now()),
 ('00000000-0000-0000-0000-0000000000db','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000ca','price','3','VERIFIED','00000000-0000-0000-0000-0000000000b9',now());
INSERT INTO knowledge_pattern (id, tenant_id, code) VALUES ('00000000-0000-0000-0000-0000000000e9','00000000-0000-0000-0000-000000000009','perto-de');
INSERT INTO surface (id, tenant_id, market_id, locale, kind, url_path, pattern_id, state) VALUES
 ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000a9','pt-BR','location_page','/perto-de/b1','00000000-0000-0000-0000-0000000000e9','LIVE'),
 ('00000000-0000-0000-0000-0000000000f2','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000a9','pt-BR','location_page','/perto-de/b2','00000000-0000-0000-0000-0000000000e9','LIVE');
INSERT INTO surface_version (id, tenant_id, surface_id, version, compiler_version, content_hash) VALUES
 ('00000000-0000-0000-0000-000000000a01','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000f1',1,'c1','h1'),
 ('00000000-0000-0000-0000-000000000a02','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000f2',1,'c1','h2');
-- b1 usa pop(único) e price(único); b2 reaproveita o claim price de b1 (compartilhado) e o seu
INSERT INTO surface_fact (surface_version_id, tenant_id, claim_id) VALUES
 ('00000000-0000-0000-0000-000000000a01','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000d9'),
 ('00000000-0000-0000-0000-000000000a01','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000da'),
 ('00000000-0000-0000-0000-000000000a02','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000da'),
 ('00000000-0000-0000-0000-000000000a02','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000db');

-- T1: blast radius da fonte: 3 claims, 2 entidades, 2 superfícies
DO $$ DECLARE r record; BEGIN
 SELECT * INTO r FROM v_source_blast_radius WHERE name='feed';
 IF r.active_claims<>3 OR r.entities_touched<>2 OR r.surfaces_depending<>2 OR r.live_surfaces_depending<>2
 THEN RAISE EXCEPTION 'T1 falhou: %', r; END IF; RAISE NOTICE 'T1 ok'; END $$;
-- T2: diferenciação: b1 tem 2 fatos, 1 único (0.500); b2 tem 2, 1 único (0.500)
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM v_surface_differentiation LOOP
  IF r.facts_total<>2 OR r.facts_unique<>1 OR r.unique_fraction<>0.500 THEN RAISE EXCEPTION 'T2 falhou: %', r; END IF; END LOOP;
 RAISE NOTICE 'T2 ok'; END $$;
-- T3: elegibilidade: a linha mais recente prevalece
INSERT INTO surface_eligibility (tenant_id, surface_id, target, eligible, reason_code, checked_at) VALUES
 ('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000f1','ai_crawler',false,'blocked_by_robots', now()-interval '1 day'),
 ('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000f1','ai_crawler',true,'ok', now());
DO $$ BEGIN IF (SELECT eligible FROM v_surface_eligibility_current WHERE target='ai_crawler') IS NOT TRUE
 THEN RAISE EXCEPTION 'T3 falhou'; END IF; RAISE NOTICE 'T3 ok'; END $$;
-- T4: consolidating exige destino
DO $$ BEGIN
 BEGIN INSERT INTO locality_lifecycle (tenant_id, entity_id, stage) VALUES ('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000c9','consolidating');
  RAISE EXCEPTION 'T4 falhou: aceitou sem destino';
 EXCEPTION WHEN check_violation THEN RAISE NOTICE 'T4 ok'; END; END $$;
-- T5: ação retire aceita
INSERT INTO opportunity (tenant_id, market_id, locale, factors_version, action) VALUES
 ('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000a9','pt-BR','v0','retire');
DO $$ BEGIN RAISE NOTICE 'T5 ok'; END $$;
ROLLBACK;
