-- Roda como menlo_app. Cada linha impressa é "ok - ..." ou "not ok - ...".
\set tenant_a aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
\set tenant_b bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb

-- T1 / T2: tenant A lê só as próprias linhas
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_a', true) AS ctx \gset
SELECT rls_test.expect('T1 tenant A reads its own rows',
  (SELECT count(*) = 2 AND bool_and(tenant_id = :'tenant_a') FROM rls_fixture.tenant_item));
SELECT rls_test.expect('T2 tenant A cannot read tenant B rows (filtered by tenant_id)',
  (SELECT count(*) FROM rls_fixture.tenant_item WHERE tenant_id = :'tenant_b') = 0);
SELECT rls_test.expect('T2 tenant A cannot read tenant B rows (filtered by payload)',
  (SELECT count(*) FROM rls_fixture.tenant_item WHERE payload LIKE 'B-%') = 0);

-- T3: inserção
SELECT rls_test.expect('T3 tenant A cannot insert a row for tenant B (42501)',
  rls_test.raises(format('INSERT INTO rls_fixture.tenant_item (tenant_id, payload) VALUES (%L, %L)', :'tenant_b', 'forged'), '42501'));
SELECT rls_test.expect('T3b positive control: tenant A can insert its own row',
  rls_test.rows_affected(format('INSERT INTO rls_fixture.tenant_item (tenant_id, payload) VALUES (%L, %L)', :'tenant_a', 'A-new')) = 1);

-- T4: update e delete
SELECT rls_test.expect('T4 tenant A updates 0 rows of tenant B',
  rls_test.rows_affected(format('UPDATE rls_fixture.tenant_item SET payload = %L WHERE tenant_id = %L', 'hacked', :'tenant_b')) = 0);
SELECT rls_test.expect('T4 tenant A deletes 0 rows of tenant B',
  rls_test.rows_affected(format('DELETE FROM rls_fixture.tenant_item WHERE tenant_id = %L', :'tenant_b')) = 0);
SELECT rls_test.expect('T4 tenant A cannot move its own row to tenant B (42501)',
  rls_test.raises(format('UPDATE rls_fixture.tenant_item SET tenant_id = %L WHERE payload = %L', :'tenant_b', 'A-1'), '42501'));
ROLLBACK;

-- T5: sem contexto de tenant, falha fechada
BEGIN;
SELECT rls_test.expect('T5 no tenant context: zero rows visible',
  (SELECT count(*) FROM rls_fixture.tenant_item) = 0);
SELECT rls_test.expect('T5 no tenant context: insert rejected (42501)',
  rls_test.raises(format('INSERT INTO rls_fixture.tenant_item (tenant_id, payload) VALUES (%L, %L)', :'tenant_a', 'no-ctx'), '42501'));
SELECT rls_test.expect('T5 no tenant context: update touches 0 rows',
  rls_test.rows_affected('UPDATE rls_fixture.tenant_item SET payload = ''x''') = 0);
SELECT rls_test.expect('T5 no tenant context: delete touches 0 rows',
  rls_test.rows_affected('DELETE FROM rls_fixture.tenant_item') = 0);
ROLLBACK;

BEGIN;
SELECT set_config('app.tenant_id', '', true) AS ctx \gset
SELECT rls_test.expect('T5 empty tenant context: zero rows visible',
  (SELECT count(*) FROM rls_fixture.tenant_item) = 0);
ROLLBACK;

BEGIN;
SELECT set_config('app.tenant_id', 'not-a-uuid', true) AS ctx \gset
SELECT rls_test.expect('T5 malformed tenant context: query errors instead of leaking (22P02)',
  rls_test.raises('SELECT count(*) FROM rls_fixture.tenant_item', '22P02'));
ROLLBACK;

-- T5b: contexto local à transação não vaza para a transação seguinte
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_a', true) AS ctx \gset
COMMIT;
SELECT rls_test.expect('T5b tenant context does not survive COMMIT',
  (SELECT count(*) FROM rls_fixture.tenant_item) = 0);
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_a', true) AS ctx \gset
ROLLBACK;
SELECT rls_test.expect('T5b tenant context does not survive ROLLBACK',
  (SELECT count(*) FROM rls_fixture.tenant_item) = 0);

-- T5c: set_config local fora de transação explícita não persiste
SELECT set_config('app.tenant_id', :'tenant_a', true) AS ctx \gset
SELECT rls_test.expect('T5c set_config(..., true) outside an explicit transaction does not persist',
  (SELECT count(*) FROM rls_fixture.tenant_item) = 0);

-- T5d: demonstração do perigo do contexto de sessão (a aplicação NUNCA deve usar false)
SELECT set_config('app.tenant_id', :'tenant_a', false) AS ctx \gset
SELECT rls_test.expect('T5d hazard: session-level context leaks across transactions (never use is_local=false)',
  (SELECT count(*) FROM rls_fixture.tenant_item) = 2);
RESET app.tenant_id;
SELECT rls_test.expect('T5d session context is cleared by RESET',
  (SELECT count(*) FROM rls_fixture.tenant_item) = 0);

-- T6: o papel de aplicação não consegue contornar o RLS
SELECT rls_test.expect('T6 app role is not superuser',
  current_setting('is_superuser') = 'off'
  AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user));
SELECT rls_test.expect('T6 app role has no BYPASSRLS',
  NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user));
SELECT rls_test.expect('T6 app role cannot create roles, databases or replicate',
  NOT (SELECT rolcreaterole OR rolcreatedb OR rolreplication FROM pg_roles WHERE rolname = current_user));
SELECT rls_test.expect('T6 app role is not the table owner',
  (SELECT relowner <> current_user::regrole FROM pg_class WHERE oid = 'rls_fixture.tenant_item'::regclass));
SELECT rls_test.expect('T6 app role is not a member of the owner role',
  NOT pg_has_role(current_user, 'rls_fixture_owner', 'USAGE'));
SELECT rls_test.expect('T6 RLS is enabled and forced on the table',
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'rls_fixture.tenant_item'::regclass));
SELECT rls_test.expect('T6 app role has SELECT/INSERT/UPDATE/DELETE and no TRUNCATE, REFERENCES or TRIGGER',
  has_table_privilege('rls_fixture.tenant_item', 'SELECT')
  AND has_table_privilege('rls_fixture.tenant_item', 'INSERT')
  AND has_table_privilege('rls_fixture.tenant_item', 'UPDATE')
  AND has_table_privilege('rls_fixture.tenant_item', 'DELETE')
  AND NOT has_table_privilege('rls_fixture.tenant_item', 'TRUNCATE')
  AND NOT has_table_privilege('rls_fixture.tenant_item', 'REFERENCES')
  AND NOT has_table_privilege('rls_fixture.tenant_item', 'TRIGGER'));
SELECT rls_test.expect('T6 app role cannot TRUNCATE (42501)',
  rls_test.raises('TRUNCATE rls_fixture.tenant_item', '42501'));
SELECT rls_test.expect('T6 app role cannot disable RLS (42501)',
  rls_test.raises('ALTER TABLE rls_fixture.tenant_item DISABLE ROW LEVEL SECURITY', '42501'));
SELECT rls_test.expect('T6 app role cannot drop the policy (42501)',
  rls_test.raises('DROP POLICY tenant_isolation ON rls_fixture.tenant_item', '42501'));
SELECT rls_test.expect('T6 app role cannot assume the owner role (42501)',
  rls_test.raises('SET ROLE rls_fixture_owner', '42501'));
SELECT rls_test.expect('T6 app role cannot create objects in the fixture schema (42501)',
  rls_test.raises('CREATE TABLE rls_fixture.sneaky (x int)', '42501'));
BEGIN;
SELECT set_config('row_security', 'off', true) AS rs \gset
SELECT rls_test.expect('T6 row_security=off makes the query error instead of bypassing RLS (42501)',
  rls_test.raises('SELECT count(*) FROM rls_fixture.tenant_item', '42501'));
ROLLBACK;

-- L1: limitação documentada, não uma garantia
BEGIN;
SELECT set_config('app.tenant_id', :'tenant_b', true) AS ctx \gset
SELECT rls_test.expect('L1 limitation: the app role can choose its own tenant context (the API layer must bind it to the authenticated user)',
  (SELECT count(*) FROM rls_fixture.tenant_item) = 2);
ROLLBACK;
