-- Teste de isolamento entre clientes com um papel SEM superusuário e SEM BYPASSRLS. Roda numa transação e desfaz.
-- Rodar como dono do esquema/superusuário; o próprio teste troca para o papel menlo_app.
BEGIN;
SET search_path = menlo, public;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='menlo_app') THEN CREATE ROLE menlo_app NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;
GRANT USAGE ON SCHEMA menlo, public TO menlo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA menlo TO menlo_app;
REVOKE INSERT, UPDATE, DELETE ON tenant FROM menlo_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA menlo TO menlo_app;

INSERT INTO tenant (id, slug, name) VALUES
 ('00000000-0000-0000-0000-0000000000aa','rls_a','A'),('00000000-0000-0000-0000-0000000000bb','rls_b','B');
INSERT INTO observation (tenant_id, metric, value, period_start, period_end, dimensions) VALUES
 ('00000000-0000-0000-0000-0000000000aa','gsc_clicks',100,'2026-10-05','2026-10-05','{"query_class":"all"}'),
 ('00000000-0000-0000-0000-0000000000bb','gsc_clicks',900,'2026-10-05','2026-10-05','{"query_class":"all"}');

SET LOCAL ROLE menlo_app;

-- T1: sem cliente definido, nada aparece (tabela, view e tenant)
DO $$ BEGIN
  IF (SELECT count(*) FROM observation) <> 0 OR (SELECT count(*) FROM v_gsc_reconciliation) <> 0 OR (SELECT count(*) FROM tenant) <> 0
  THEN RAISE EXCEPTION 'T1 FALHOU: algo visível sem tenant definido';
  ELSE RAISE NOTICE 'T1 ok: sem tenant definido, observation, view e tenant ficam vazios'; END IF;
END $$;

SELECT set_config('menlo.tenant_id','00000000-0000-0000-0000-0000000000aa', true);

-- T2: tabela isolada
DO $$ BEGIN
  IF (SELECT count(*) FROM observation) = 1 AND (SELECT sum(value) FROM observation) = 100
  THEN RAISE NOTICE 'T2 ok: cliente A vê só a própria observação';
  ELSE RAISE EXCEPTION 'T2 FALHOU'; END IF;
END $$;

-- T3: view isolada (antes da 0.5 vazava)
DO $$ BEGIN
  IF (SELECT count(*) FROM v_gsc_reconciliation) = 1 AND (SELECT total_clicks FROM v_gsc_reconciliation) = 100
  THEN RAISE NOTICE 'T3 ok: v_gsc_reconciliation mostra só o cliente A';
  ELSE RAISE EXCEPTION 'T3 FALHOU: view vazou entre clientes'; END IF;
END $$;

-- T4: tabela tenant mostra só o próprio cliente
DO $$ BEGIN
  IF (SELECT count(*) FROM tenant) = 1 AND (SELECT slug FROM tenant) = 'rls_a'
  THEN RAISE NOTICE 'T4 ok: tenant mostra só a própria linha';
  ELSE RAISE EXCEPTION 'T4 FALHOU: lista de clientes visível'; END IF;
END $$;

-- T5: escrever em outro cliente é barrado
DO $$ BEGIN
  BEGIN
    INSERT INTO observation (tenant_id, metric, value, period_start, period_end, dimensions)
    VALUES ('00000000-0000-0000-0000-0000000000bb','gsc_clicks',1,'2026-01-01','2026-01-01','{}');
    RAISE EXCEPTION 'T5 FALHOU: escreveu em outro cliente';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'T5 ok: escrita em outro cliente barrada'; END;
END $$;

-- T6: nenhuma view do esquema roda com permissão do dono
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace
   WHERE s.nspname='menlo' AND c.relkind='v' AND NOT coalesce('security_invoker=true' = ANY(c.reloptions), false);
  IF n = 0 THEN RAISE NOTICE 'T6 ok: todas as views do esquema usam security_invoker';
  ELSE RAISE EXCEPTION 'T6 FALHOU: % view(s) sem security_invoker', n; END IF;
END $$;

-- T7: o papel de aplicação não consegue criar nem apagar clientes
DO $$ BEGIN
  BEGIN
    INSERT INTO tenant (slug, name) VALUES ('invasor','x');
    RAISE EXCEPTION 'T7 FALHOU: papel de aplicação criou cliente';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'T7 ok: papel de aplicação não cria cliente'; END;
END $$;
ROLLBACK;
