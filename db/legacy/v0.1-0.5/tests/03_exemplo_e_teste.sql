-- Exemplo mínimo e teste de fumaça. Roda em transação e desfaz no final (ROLLBACK).
-- Dados fictícios, só para provar que o modelo responde às duas perguntas centrais.
BEGIN;
SET search_path = menlo, public;

INSERT INTO tenant (id, slug, name) VALUES ('00000000-0000-0000-0000-000000000001','demo','Cliente demo');
SELECT set_config('menlo.tenant_id','00000000-0000-0000-0000-000000000001', true);

INSERT INTO market (id, tenant_id, code, country_code, default_locale, currency)
VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000001','br','BR','pt-BR','BRL');

INSERT INTO source (id, tenant_id, name, kind, authority_class) VALUES
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000001','feed_cliente','first_party_feed','primary'),
 ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000001','dados_publicos_cidade','public_dataset','primary');

INSERT INTO entity_type (tenant_id, code, label) VALUES
 ('00000000-0000-0000-0000-000000000001','city','Cidade'),
 ('00000000-0000-0000-0000-000000000001','neighborhood','Bairro'),
 ('00000000-0000-0000-0000-000000000001','property','Imóvel');

INSERT INTO entity_type_schema (tenant_id, entity_type, attribute_key, requirement, min_claim_class, freshness_sla) VALUES
 ('00000000-0000-0000-0000-000000000001','neighborhood','avg_price_per_sqm','required','DERIVED', interval '90 days'),
 ('00000000-0000-0000-0000-000000000001','neighborhood','population','required','VERIFIED', NULL),
 ('00000000-0000-0000-0000-000000000001','neighborhood','nearest_metro','recommended','DERIVED', NULL);

INSERT INTO relation_type (tenant_id, code, from_type, to_type, label) VALUES
 ('00000000-0000-0000-0000-000000000001','belongs_to','neighborhood','city','pertence a');

INSERT INTO entity (id, tenant_id, entity_type, canonical_key, name) VALUES
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000001','city','sp','São Paulo'),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-000000000001','neighborhood','pinheiros','Pinheiros');

INSERT INTO relation (tenant_id, relation_type, from_entity, to_entity, claim_class, confidence, source_id)
VALUES ('00000000-0000-0000-0000-000000000001','belongs_to','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c1','VERIFIED',1,'00000000-0000-0000-0000-0000000000b2');

-- Dois fatos do bairro (preço por m² e população). Falta nearest_metro (recomendado).
INSERT INTO claim (id, tenant_id, entity_id, attribute_key, value, unit, claim_class, confidence, source_id, observed_at) VALUES
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c2','avg_price_per_sqm','18200','BRL/m2','DERIVED',0.8,'00000000-0000-0000-0000-0000000000b1', now() - interval '10 days'),
 ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c2','population','123000','pessoas','VERIFIED',0.95,'00000000-0000-0000-0000-0000000000b2', now() - interval '200 days');

-- Template, superfície e linhagem
INSERT INTO template (id, tenant_id, code, version, entity_type, contract)
VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000001','neighborhood_page',1,'neighborhood','{"required":["avg_price_per_sqm","population"]}');

INSERT INTO surface (id, tenant_id, market_id, locale, kind, url_path, entity_id, template_id, state, index_policy)
VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','pt-BR','location_page','/perto-de/pinheiros','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000e1','LIVE','index');

INSERT INTO surface_version (id, tenant_id, surface_id, version, template_id, compiler_version, content_hash)
VALUES ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1',1,'00000000-0000-0000-0000-0000000000e1','compiler-0.1','hash1');

INSERT INTO surface_fact (surface_version_id, tenant_id, claim_id, role) VALUES
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d1','headline'),
 ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d2','body');

-- Oportunidade: sem nota única, fatores separados, ação "criar"
INSERT INTO opportunity (tenant_id, market_id, locale, entity_id, intent, gap_types, factors, factors_version, action, status)
VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','pt-BR','00000000-0000-0000-0000-0000000000c2','local','{relationship,evidence}','{"demand":"high","coverage":0.67}','v0','create','open');

-- ===== TESTES =====
-- T1: prontidão do bairro (esperado: required_total=2, present=2, verified=1, stale=0)
SELECT 'T1 prontidao' AS teste, required_total, required_present, required_verified, required_stale
FROM v_entity_readiness WHERE entity_id = '00000000-0000-0000-0000-0000000000c2';

-- T2: mudança de fato. Cria nova versão do preço e consulta o que ela afeta (esperado: 1 página)
INSERT INTO claim (id, tenant_id, entity_id, attribute_key, value, unit, claim_class, confidence, source_id, observed_at)
VALUES ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000c2','avg_price_per_sqm','19400','BRL/m2','DERIVED',0.8,'00000000-0000-0000-0000-0000000000b1', now());
UPDATE claim SET status='superseded', superseded_by='00000000-0000-0000-0000-0000000000d3' WHERE id='00000000-0000-0000-0000-0000000000d1';
SELECT 'T2 paginas afetadas pelo fato antigo' AS teste, url_path, version
FROM surfaces_affected_by_claim('00000000-0000-0000-0000-0000000000d1');

-- T3: claim é imutável (esperado: erro capturado)
DO $$ BEGIN
  BEGIN
    UPDATE claim SET value='1' WHERE id='00000000-0000-0000-0000-0000000000d2';
    RAISE EXCEPTION 'T3 FALHOU: deveria ter bloqueado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'T3 FALHOU%' THEN RAISE; END IF;
    RAISE NOTICE 'T3 ok: %', SQLERRM;
  END;
END $$;

-- T4: relação em vigor duplicada é bloqueada (esperado: erro de exclusão)
DO $$ BEGIN
  BEGIN
    INSERT INTO relation (tenant_id, relation_type, from_entity, to_entity, claim_class)
    VALUES ('00000000-0000-0000-0000-000000000001','belongs_to','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000c1','DERIVED');
    RAISE EXCEPTION 'T4 FALHOU: deveria ter bloqueado';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'T4 ok: relação duplicada bloqueada';
  END;
END $$;

-- T5: superfície REDIRECT sem destino é bloqueada
DO $$ BEGIN
  BEGIN
    INSERT INTO surface (tenant_id, market_id, locale, kind, url_path, state)
    VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1','pt-BR','location_page','/x','REDIRECT');
    RAISE EXCEPTION 'T5 FALHOU: deveria ter bloqueado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'T5 ok: REDIRECT sem destino bloqueado';
  END;
END $$;

ROLLBACK;
