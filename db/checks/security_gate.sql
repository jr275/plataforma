-- Fonte única das verificações de segurança do catálogo (gate). É UMA consulta (sem ponto e vírgula final) que
-- devolve (ord integer, ok boolean, line text): uma linha por verificação. Não altera nada.
-- Usada por scripts/db-migrate.sh (gate transacional, dentro da transação de cada migration) e por
-- scripts/check-catalog.sh (verificação avulsa): ambos colam este texto dentro de "SELECT ... FROM ( <consulta> ) g".
-- Variáveis do psql esperadas: app_role, ledger_schema, global_allow, executor_role (vazio = sem verificações do executor)
-- e check_stale ('on' confere que cada tabela da lista global existe; o gate de linha de base do runner usa 'off', porque
-- a lista pode já citar a tabela que a migration pendente vai criar).
--
-- Propriedades de projeto:
--   - Inspeciona o catálogo real do PostgreSQL (pg_catalog); não confia em comentários nem em configuração declarada.
--   - Todas as relações de catálogo são qualificadas com pg_catalog. (e o chamador fixa search_path = pg_catalog, pg_temp):
--     uma tabela temporária chamada pg_class ou uma função com o nome de has_table_privilege criada por uma migration
--     não pode fazer o gate ler dados falsos.
--   - Falha fechada: papel inexistente ou invariante que não pode ser verificada resulta em "not ok".
--   - Tabelas acessíveis à aplicação são do tenant (tenant_id uuid NOT NULL, RLS ligado e forçado, política que cita
--     tenant_id) ou estão na lista aprovada de tabelas globais (somente leitura). Tabelas que a aplicação não alcança
--     não são avaliadas. Sem tabelas acessíveis, o resultado é vacuoso e diz isso.
--   - NÃO prova isolamento entre tenants (teste comportamental de RLS) e NÃO autentica tenant algum.
--   - FORCE ROW LEVEL SECURITY não protege contra o dono da tabela, que pode desligar o RLS por DDL; o gate DETECTA o
--     estado resultante antes do COMMIT, mas não protege contra um administrador ou superusuário que possa alterar o
--     gate, o runner, o ledger ou a configuração do banco.
WITH
app AS (SELECT r.oid AS oid, r.rolname AS rolname FROM pg_catalog.pg_roles r WHERE r.rolname = :'app_role'),
exe AS (SELECT r.oid AS oid FROM pg_catalog.pg_roles r WHERE r.rolname = nullif(:'executor_role', '')),
allow AS (SELECT unnest(string_to_array(nullif(:'global_allow', ''), ',')) AS fq),
ledger AS (SELECT c.oid AS oid, c.relowner AS owner
             FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = :'ledger_schema' AND c.relname = 'ledger'),
acc AS (
  -- Relações alcançáveis pela aplicação: privilégio de TABELA ou de COLUNA (SELECT, INSERT, UPDATE, REFERENCES).
  SELECT c.oid AS oid, c.relkind AS relkind, n.nspname || '.' || c.relname AS fq
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace CROSS JOIN app
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
     AND n.nspname <> :'ledger_schema'
     AND (CASE WHEN c.relkind IN ('r', 'p', 'v', 'm', 'f')
               THEN (pg_catalog.has_table_privilege(app.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                     OR pg_catalog.has_any_column_privilege(app.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')) ELSE false END)
),
tabs AS (
  SELECT a.oid AS oid, a.fq AS fq, c.relrowsecurity AS rls, c.relforcerowsecurity AS frls
    FROM acc a JOIN pg_catalog.pg_class c ON c.oid = a.oid
   WHERE a.relkind IN ('r', 'p')
),
canon_funcs AS (
  -- Funções auxiliares aceitas na forma canônica de política: current_tenant_id() sem argumentos, que devolve
  -- nullif(current_setting('app.tenant_id', true), '')::uuid, SQL, STABLE, SECURITY INVOKER, sem configuração própria e
  -- que não pertence à aplicação. A comparação do corpo é por texto normalizado (sem espaços, minúsculas).
  SELECT n.nspname AS sname
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace CROSS JOIN app
   WHERE p.proname = 'current_tenant_id' AND p.pronargs = 0 AND p.prorettype = 'uuid'::regtype AND p.prokind = 'f'
     AND p.provolatile = 's' AND NOT p.prosecdef AND p.proconfig IS NULL AND p.proowner <> app.oid
     AND p.prolang = (SELECT l.oid FROM pg_catalog.pg_language l WHERE l.lanname = 'sql')
     AND regexp_replace(lower(p.prosrc), '[[:space:]]+', '', 'g') IN
         ('selectnullif(current_setting(''app.tenant_id'',true),'''')::uuid', 'selectnullif(current_setting(''app.tenant_id'',true),'''')::uuid;')
),
pexpr AS (
  SELECT p.polrelid AS polrelid, p.polpermissive AS polpermissive, p.polcmd AS polcmd, p.polroles AS polroles,
         pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS q, pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS wc
    FROM pg_catalog.pg_policy p
),
pcanon AS (
  -- Forma canônica da expressão (como o catálogo a representa): coluna tenant_id igual a
  --   nullif(current_setting('app.tenant_id', true), '')::uuid   (ou sem o nullif)   ou a   <esquema>.current_tenant_id().
  -- Qualquer outra forma (OR, AND, IS NOT NULL, comparação com outra coisa) NÃO é canônica.
  SELECT x.polrelid, x.polpermissive, x.polcmd, x.polroles, x.q, x.wc,
         CASE WHEN x.q IS NULL THEN false
              WHEN x.q ~ '^\(tenant_id = \(NULLIF\(current_setting\(''app\.tenant_id''::text, true\), ''''::text\)\)::uuid\)$' THEN true
              WHEN x.q ~ '^\(tenant_id = \(current_setting\(''app\.tenant_id''::text, true\)\)::uuid\)$' THEN true
              ELSE coalesce(substring(x.q from '^\(tenant_id = ([a-z_][a-z0-9_]*)\.current_tenant_id\(\)\)$') IN (SELECT sname FROM canon_funcs), false) END AS q_ok,
         CASE WHEN x.wc IS NULL THEN false
              WHEN x.wc ~ '^\(tenant_id = \(NULLIF\(current_setting\(''app\.tenant_id''::text, true\), ''''::text\)\)::uuid\)$' THEN true
              WHEN x.wc ~ '^\(tenant_id = \(current_setting\(''app\.tenant_id''::text, true\)\)::uuid\)$' THEN true
              ELSE coalesce(substring(x.wc from '^\(tenant_id = ([a-z_][a-z0-9_]*)\.current_tenant_id\(\)\)$') IN (SELECT sname FROM canon_funcs), false) END AS wc_ok
    FROM pexpr x
),
pol AS (
  SELECT t.oid AS toid,
         count(p.polrelid) FILTER (WHERE p.polpermissive) AS n_permissive,
         count(p.polrelid) FILTER (WHERE p.polpermissive AND NOT (
              (p.polcmd IN ('r', 'd') AND p.q_ok)
           OR (p.polcmd = 'a' AND p.wc_ok)
           OR (p.polcmd IN ('w', '*') AND p.q_ok AND (p.wc IS NULL OR p.wc_ok))
         )) AS n_bad
    FROM tabs t CROSS JOIN app
    LEFT JOIN pcanon p ON p.polrelid = t.oid AND (0 = ANY (p.polroles) OR app.oid = ANY (p.polroles))
   GROUP BY t.oid
)
SELECT ord, ok, line FROM (

  -- C1 o papel da aplicação existe
  SELECT 10 AS ord, EXISTS (SELECT 1 FROM app) AS ok, 'C1 application role exists: ' || :'app_role' AS line

  -- C2 atributos do papel
  UNION ALL SELECT 20, coalesce((SELECT NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
                                   FROM pg_catalog.pg_roles r JOIN app ON app.oid = r.oid), false),
    'C2 application role has no privileged attributes (superuser, BYPASSRLS, CREATEROLE, CREATEDB, REPLICATION)'

  -- C3 sem associação a outros papéis
  UNION ALL SELECT 30, coalesce((SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = app.oid) FROM app), false),
    'C3 application role is not a member of any other role'

  -- C4 não é dono de nada
  UNION ALL SELECT 40, coalesce((SELECT
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.relowner = app.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.proowner = app.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspowner = app.oid)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database d WHERE d.datdba = app.oid) FROM app), false),
    'C4 application role owns no relation, function, schema or database'

  -- C5 sem CREATE em esquema ou banco e sem TEMP
  UNION ALL SELECT 50, coalesce((SELECT
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
                      AND pg_catalog.has_schema_privilege(app.oid, n.oid, 'CREATE'))
    AND NOT pg_catalog.has_database_privilege(app.oid, current_database(), 'CREATE,TEMPORARY') FROM app), false),
    'C5 application role has no CREATE on any schema or on the database and no TEMP privilege'

  -- C6 nenhum default privilege em favor da aplicação nem de PUBLIC
  UNION ALL SELECT 60, coalesce((SELECT NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
         WHERE a.grantee = 0 OR a.grantee = app.oid) FROM app), false),
    'C6 no ALTER DEFAULT PRIVILEGES entry grants anything to the application role or to PUBLIC'

  -- C7 metadados de migration inacessíveis à aplicação
  UNION ALL SELECT 70, coalesce((SELECT
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname = :'ledger_schema'
                      AND pg_catalog.has_schema_privilege(app.oid, n.oid, 'USAGE,CREATE'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = :'ledger_schema' AND c.relkind IN ('r','p','v','m','S')
                       AND (pg_catalog.has_table_privilege(app.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                            OR (CASE WHEN c.relkind <> 'S' THEN pg_catalog.has_any_column_privilege(app.oid, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END)))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                     WHERE n.nspname = :'ledger_schema' AND pg_catalog.has_function_privilege(app.oid, p.oid, 'EXECUTE')) FROM app), false),
    'C7 migration metadata (' || :'ledger_schema' || ') is inaccessible to the application role'

  -- C8 tabelas acessíveis à aplicação
  UNION ALL SELECT 80000 + row_number() OVER (ORDER BY fq, k)::int, ok, line FROM (
    SELECT t.fq, 1 AS k,
           CASE WHEN EXISTS (SELECT 1 FROM allow a WHERE a.fq = t.fq)
                THEN coalesce(NOT (pg_catalog.has_table_privilege((SELECT oid FROM app), t.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                                   OR pg_catalog.has_any_column_privilege((SELECT oid FROM app), t.oid, 'INSERT,UPDATE,REFERENCES')), false)
                ELSE EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = t.oid AND a.attname = 'tenant_id'
                              AND a.atttypid = 'uuid'::regtype AND a.attnotnull AND NOT a.attisdropped) END AS ok,
           CASE WHEN EXISTS (SELECT 1 FROM allow a WHERE a.fq = t.fq)
                THEN 'C8 ' || t.fq || ': approved global/reference table is read-only for the application role'
                ELSE 'C8 ' || t.fq || ': tenant-scoped table has a tenant_id uuid NOT NULL column (or must be an approved global table)' END AS line
      FROM tabs t
    UNION ALL
    SELECT t.fq, 2, (t.rls AND t.frls), 'C8 ' || t.fq || ': ROW LEVEL SECURITY is enabled and forced'
      FROM tabs t WHERE NOT EXISTS (SELECT 1 FROM allow a WHERE a.fq = t.fq)
    UNION ALL
    SELECT t.fq, 3, (p.n_permissive > 0 AND p.n_bad = 0),
           'C8 ' || t.fq || ': at least one tenant policy exists for the application role and every permissive policy references tenant_id'
      FROM tabs t JOIN pol p ON p.toid = t.oid WHERE NOT EXISTS (SELECT 1 FROM allow a WHERE a.fq = t.fq)
    UNION ALL
    SELECT t.fq, 4, coalesce(NOT pg_catalog.has_table_privilege((SELECT oid FROM app), t.oid, 'TRUNCATE,REFERENCES,TRIGGER'), false),
           'C8 ' || t.fq || ': application role has no TRUNCATE, REFERENCES or TRIGGER'
      FROM tabs t WHERE NOT EXISTS (SELECT 1 FROM allow a WHERE a.fq = t.fq)
    UNION ALL
    SELECT a.fq, 5,
           EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname || '.' || c.relname = a.fq AND c.relkind IN ('r', 'p') AND n.nspname <> :'ledger_schema'),
           'C8 ' || a.fq || ': allowlisted global table exists (stale allowlist entries are errors)'
      FROM allow a WHERE :'check_stale' = 'on'
    UNION ALL
    SELECT '', 6, true, 'C8 no application-accessible tables exist yet (nothing to check; this is vacuous)'
     WHERE NOT EXISTS (SELECT 1 FROM tabs)
  ) c8

  -- C9 nenhuma função SECURITY DEFINER executável pela aplicação
  UNION ALL SELECT 90, coalesce((SELECT NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         WHERE p.prosecdef AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
           AND pg_catalog.has_function_privilege(app.oid, p.oid, 'EXECUTE')) FROM app), false),
    'C9 no SECURITY DEFINER function is executable by the application role'

  -- C10 views com security_invoker; nenhuma view materializada acessível (privilégio de tabela ou de coluna)
  UNION ALL SELECT 100, coalesce((SELECT NOT EXISTS (
        SELECT 1 FROM acc JOIN pg_catalog.pg_class c ON c.oid = acc.oid
         WHERE (c.relkind = 'v' AND NOT coalesce(c.reloptions @> ARRAY['security_invoker=true'], false)) OR c.relkind = 'm') FROM app), false),
    'C10 every view reachable by the application role is security_invoker and no materialized view is reachable'

  -- C11 nenhuma tabela estrangeira acessível (o RLS não se aplica a tabelas estrangeiras)
  UNION ALL SELECT 101, coalesce((SELECT NOT EXISTS (SELECT 1 FROM acc WHERE acc.relkind = 'f') FROM app), false),
    'C11 no foreign table is reachable by the application role (row level security does not apply to foreign tables)'

  -- C12 nenhuma regra (CREATE RULE) em relação acessível, exceto o _RETURN implícito das views
  UNION ALL SELECT 102, coalesce((SELECT NOT EXISTS (
        SELECT 1 FROM acc JOIN pg_catalog.pg_rewrite r ON r.ev_class = acc.oid WHERE r.rulename <> '_RETURN') FROM app), false),
    'C12 no rewrite rule other than a view definition exists on any relation reachable by the application role'

  -- C13 nenhum gatilho cuja função seja SECURITY DEFINER em relação acessível (a DML da aplicação o executaria com privilégios do dono)
  UNION ALL SELECT 103, coalesce((SELECT NOT EXISTS (
        SELECT 1 FROM acc JOIN pg_catalog.pg_trigger t ON t.tgrelid = acc.oid JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
         WHERE NOT t.tgisinternal AND t.tgenabled <> 'D' AND p.prosecdef) FROM app), false),
    'C13 no SECURITY DEFINER trigger function fires on a relation reachable by the application role'

  -- C14 nenhum parâmetro de papel ou de banco que escolha o contexto de tenant, o RLS ou o papel da sessão da aplicação
  UNION ALL SELECT 104, coalesce((SELECT NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) AS cfg
         WHERE (s.setrole = app.oid OR s.setrole = 0)
           AND (s.setdatabase = 0 OR s.setdatabase = (SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname = current_database()))
           AND (split_part(cfg, '=', 1) LIKE 'app.%' OR split_part(cfg, '=', 1) IN ('row_security', 'session_replication_role', 'role'))) FROM app), false),
    'C14 no role-level or database-level setting preselects a tenant context (app.*), row_security, session_replication_role or role for the application role'

  -- G1..G8: invariantes do modelo de papéis e de PUBLIC (G1, G2, G3, G7 e G8 só quando há executor)
  UNION ALL SELECT 110, coalesce((SELECT NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
                                    FROM pg_catalog.pg_roles r JOIN exe ON exe.oid = r.oid), false),
    'G1 migration executor has no privileged attributes (superuser, BYPASSRLS, CREATEROLE, CREATEDB, REPLICATION)'
   WHERE nullif(:'executor_role', '') IS NOT NULL
  UNION ALL SELECT 120, coalesce((SELECT NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = exe.oid) FROM exe), false),
    'G2 migration executor is not a member of any role (no privilege inheritance, no SET ROLE targets)'
   WHERE nullif(:'executor_role', '') IS NOT NULL
  UNION ALL SELECT 130, coalesce((SELECT NOT pg_catalog.has_table_privilege(exe.oid, l.oid, 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                                         AND l.owner <> exe.oid FROM exe, ledger l), false),
    'G3 migration executor can neither own nor alter the ledger (only SELECT and INSERT)'
   WHERE nullif(:'executor_role', '') IS NOT NULL
  UNION ALL SELECT 140, NOT pg_catalog.has_database_privilege('public', current_database(), 'CONNECT,CREATE,TEMPORARY'),
    'G4 PUBLIC has no CONNECT, CREATE or TEMP privilege on the database'
  UNION ALL SELECT 150,
        NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
                      AND pg_catalog.has_schema_privilege('public', n.oid, 'USAGE,CREATE'))
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
                       AND ((CASE WHEN c.relkind IN ('r','p','v','m','f')
                                  THEN (pg_catalog.has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                                        OR pg_catalog.has_any_column_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES')) ELSE false END)
                         OR (CASE WHEN c.relkind = 'S' THEN pg_catalog.has_sequence_privilege('public', c.oid, 'USAGE,SELECT,UPDATE') ELSE false END))),
    'G5 PUBLIC has no privilege on any schema, table, view or sequence outside the system schemas'
  UNION ALL SELECT 160, coalesce((SELECT NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
           AND (CASE WHEN c.relkind = 'S' THEN pg_catalog.has_sequence_privilege(app.oid, c.oid, 'UPDATE') ELSE false END)) FROM app), false),
    'G6 application role has no UPDATE (setval) privilege on any sequence'
  UNION ALL SELECT 170, coalesce((SELECT count(*) = 2 FROM pg_catalog.pg_trigger t JOIN ledger l ON l.oid = t.tgrelid
                                   WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
                                     AND t.tgname IN ('ledger_no_update_delete', 'ledger_no_truncate')), false),
    'G7 the ledger append-only triggers exist and are enabled'
   WHERE nullif(:'executor_role', '') IS NOT NULL
  UNION ALL SELECT 180, coalesce((SELECT NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = :'ledger_schema' AND (c.relowner = exe.oid OR c.relowner = app.oid))
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname = :'ledger_schema' AND (n.nspowner = exe.oid OR n.nspowner = app.oid))
        FROM exe, app), false),
    'G8 migration metadata objects are owned by neither the executor nor the application role'
   WHERE nullif(:'executor_role', '') IS NOT NULL
) g
