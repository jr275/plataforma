-- Verificação (somente leitura) do MODELO DE PAPÉIS do ADR-013 no banco atual: administrador (dono do ledger),
-- executor das migrations e aplicação. Imprime "ok - ..." ou "not ok - ..." por verificação. Inspeciona o catálogo
-- real (atributos, associações, privilégios e donos), não os nomes dos papéis.
-- Variáveis do psql: admin_role, migrator_role, app_role (padrões: plataforma_admin, plataforma_migrator, menlo_app),
-- ledger_schema (padrão: plataforma_migrations). Usado por scripts/db-bootstrap.sh.
\if :{?admin_role}
\else
\set admin_role plataforma_admin
\endif
\if :{?migrator_role}
\else
\set migrator_role plataforma_migrator
\endif
\if :{?app_role}
\else
\set app_role menlo_app
\endif
\if :{?ledger_schema}
\else
\set ledger_schema plataforma_migrations
\endif
SET search_path = pg_catalog, pg_temp;

SELECT (count(DISTINCT rolname) = 3 AND (SELECT count(DISTINCT x) FROM (VALUES (:'admin_role'), (:'migrator_role'), (:'app_role')) v(x)) = 3) AS roles_ok
  FROM pg_catalog.pg_roles WHERE rolname IN (:'admin_role', :'migrator_role', :'app_role') \gset
SELECT CASE WHEN :'roles_ok'::boolean THEN 'ok' ELSE 'not ok' END || ' - R1 the three roles exist and are distinct: administrator, migration executor, application';
\if :roles_ok

-- R2 atributos reais de cada papel
SELECT CASE WHEN rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
            THEN 'ok' ELSE 'not ok' END
       || ' - R2 role ' || rolname || ' can log in and has no SUPERUSER, CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS'
  FROM pg_catalog.pg_roles WHERE rolname IN (:'admin_role', :'migrator_role', :'app_role') ORDER BY rolname;

-- R3 nenhuma associação a papéis (nem de nenhum papel a eles): sem herança de privilégios, sem alvos de SET ROLE
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid IN (m.member, m.roleid)
                              WHERE r.rolname IN (:'admin_role', :'migrator_role', :'app_role'))
            THEN 'ok' ELSE 'not ok' END || ' - R3 none of the three roles is a member of any role, and no role is a member of them';

-- R4 PostgreSQL 16
SELECT CASE WHEN current_setting('server_version_num')::int BETWEEN 160000 AND 169999 THEN 'ok' ELSE 'not ok' END
       || ' - R4 the server is PostgreSQL 16 (' || current_setting('server_version') || ')';

-- R5 banco: dono, PUBLIC e privilégios de cada papel
SELECT CASE WHEN (SELECT pg_catalog.pg_get_userbyid(datdba) FROM pg_catalog.pg_database WHERE datname = current_database()) = :'admin_role'
            THEN 'ok' ELSE 'not ok' END || ' - R5 the administrator owns the database';
SELECT CASE WHEN NOT pg_catalog.has_database_privilege('public', current_database(), 'CONNECT,CREATE,TEMPORARY') THEN 'ok' ELSE 'not ok' END
       || ' - R5 PUBLIC has no CONNECT, CREATE or TEMP on the database';
SELECT CASE WHEN pg_catalog.has_database_privilege(:'app_role', current_database(), 'CONNECT')
             AND NOT pg_catalog.has_database_privilege(:'app_role', current_database(), 'CREATE,TEMPORARY') THEN 'ok' ELSE 'not ok' END
       || ' - R5 the application role has CONNECT only (no CREATE, no TEMP)';
SELECT CASE WHEN pg_catalog.has_database_privilege(:'migrator_role', current_database(), 'CONNECT')
             AND pg_catalog.has_database_privilege(:'migrator_role', current_database(), 'CREATE')
             AND pg_catalog.has_database_privilege(:'migrator_role', current_database(), 'TEMPORARY') THEN 'ok' ELSE 'not ok' END
       || ' - R5 the migration executor has CONNECT, CREATE (to create product schemas) and TEMP (for the runner)';

-- R6 esquema public sem privilégios para PUBLIC, aplicação ou executor
SELECT CASE WHEN NOT pg_catalog.has_schema_privilege('public', 'public', 'USAGE,CREATE')
             AND NOT pg_catalog.has_schema_privilege(:'app_role', 'public', 'USAGE,CREATE')
             AND NOT pg_catalog.has_schema_privilege(:'migrator_role', 'public', 'USAGE,CREATE') THEN 'ok' ELSE 'not ok' END
       || ' - R6 schema public is closed to PUBLIC, the application role and the migration executor';

-- R7 donos dos objetos de metadados de migration: o administrador
SELECT CASE WHEN pg_catalog.pg_get_userbyid((SELECT nspowner FROM pg_catalog.pg_namespace WHERE nspname = :'ledger_schema')) = :'admin_role'
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                              WHERE n.nspname = :'ledger_schema' AND pg_catalog.pg_get_userbyid(c.relowner) <> :'admin_role')
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                              WHERE n.nspname = :'ledger_schema' AND pg_catalog.pg_get_userbyid(p.proowner) <> :'admin_role')
            THEN 'ok' ELSE 'not ok' END || ' - R7 the migration metadata schema and every object in it are owned by the administrator';

-- R8 privilégios exatos sobre ledger e lock
SELECT to_regclass(format('%I.ledger', :'ledger_schema'))::oid AS ledger_oid, to_regclass(format('%I.run_lock', :'ledger_schema'))::oid AS lock_oid \gset
SELECT CASE WHEN NULLIF(:'ledger_oid', '') IS NOT NULL AND NULLIF(:'lock_oid', '') IS NOT NULL THEN 'ok' ELSE 'not ok' END || ' - R8 the ledger and run_lock tables exist';
SELECT CASE WHEN NULLIF(:'ledger_oid', '') IS NOT NULL
             AND pg_catalog.has_schema_privilege(:'migrator_role', :'ledger_schema', 'USAGE')
             AND NOT pg_catalog.has_schema_privilege(:'migrator_role', :'ledger_schema', 'CREATE')
             AND pg_catalog.has_table_privilege(:'migrator_role', NULLIF(:'ledger_oid', '')::oid, 'SELECT')
             AND pg_catalog.has_table_privilege(:'migrator_role', NULLIF(:'ledger_oid', '')::oid, 'INSERT')
             AND NOT pg_catalog.has_table_privilege(:'migrator_role', NULLIF(:'ledger_oid', '')::oid, 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
             AND pg_catalog.has_table_privilege(:'migrator_role', NULLIF(:'lock_oid', '')::oid, 'UPDATE')
             AND NOT pg_catalog.has_table_privilege(:'migrator_role', NULLIF(:'lock_oid', '')::oid, 'SELECT,INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            THEN 'ok' ELSE 'not ok' END
       || ' - R8 the migration executor holds exactly: USAGE on the metadata schema, SELECT+INSERT on the ledger, UPDATE on run_lock';
SELECT CASE WHEN NULLIF(:'ledger_oid', '') IS NOT NULL
             AND NOT pg_catalog.has_schema_privilege(:'app_role', :'ledger_schema', 'USAGE,CREATE')
             AND NOT pg_catalog.has_table_privilege(:'app_role', NULLIF(:'ledger_oid', '')::oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
             AND NOT pg_catalog.has_table_privilege(:'app_role', NULLIF(:'lock_oid', '')::oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
             AND NOT pg_catalog.has_schema_privilege('public', :'ledger_schema', 'USAGE,CREATE')
             AND NOT pg_catalog.has_table_privilege('public', NULLIF(:'ledger_oid', '')::oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
             AND NOT pg_catalog.has_table_privilege('public', NULLIF(:'lock_oid', '')::oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            THEN 'ok' ELSE 'not ok' END
       || ' - R8 the application role and PUBLIC have no access to the ledger, the lock or their schema';

-- R9 gatilhos append-only ativos
SELECT CASE WHEN NULLIF(:'ledger_oid', '') IS NOT NULL
             AND (SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid = NULLIF(:'ledger_oid', '')::oid AND NOT t.tgisinternal
                     AND t.tgenabled = 'O' AND t.tgname IN ('ledger_no_update_delete', 'ledger_no_truncate')) = 2
            THEN 'ok' ELSE 'not ok' END || ' - R9 the ledger append-only triggers exist and are enabled';
\endif
