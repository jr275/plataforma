-- Roda como rls_fixture_owner (dono do esquema, sem superusuário nem BYPASSRLS).
SELECT rls_test.expect('T7 owner is not superuser and has no BYPASSRLS',
  NOT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user));
SELECT rls_test.expect('T7 owner owns the table and is not the application role',
  (SELECT relowner = current_user::regrole FROM pg_class WHERE oid = 'rls_fixture.tenant_item'::regclass)
  AND current_user <> 'menlo_app');
SELECT rls_test.expect('T7 owner holds privileges the app role lacks (TRUNCATE)',
  has_table_privilege('rls_fixture.tenant_item', 'TRUNCATE'));
SELECT rls_test.expect('T7 owner can run DDL (comment on table)',
  rls_test.succeeds('COMMENT ON TABLE rls_fixture.tenant_item IS ''harness'''));
SELECT rls_test.expect('T7 owner cannot assume the app role (42501)',
  rls_test.raises('SET ROLE menlo_app', '42501'));
-- FORCE RLS: o dono também está sujeito ao RLS (nenhuma política o cobre, então não vê nada).
SELECT rls_test.expect('T7 forced RLS applies to the owner: zero rows visible',
  (SELECT count(*) FROM rls_fixture.tenant_item) = 0);
SELECT rls_test.expect('T7 forced RLS applies to the owner: insert rejected (42501)',
  rls_test.raises('INSERT INTO rls_fixture.tenant_item (tenant_id, payload) VALUES (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'', ''owner'')', '42501'));
