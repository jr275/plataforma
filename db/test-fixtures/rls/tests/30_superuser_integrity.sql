-- Roda como o superusuário de bootstrap do cluster DESCARTÁVEL: comportamento de bypass e integridade.
SELECT rls_test.expect('S1 superuser bypasses RLS even with FORCE (documented behavior: the app role must never be a superuser)',
  (SELECT count(*) FROM rls_fixture.tenant_item) = 4);
SELECT rls_test.expect('S2 data of tenant A is unchanged after the app-role tests',
  (SELECT string_agg(payload, ',' ORDER BY payload) FROM rls_fixture.tenant_item WHERE tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 'A-1,A-2');
SELECT rls_test.expect('S2 data of tenant B is unchanged after the app-role tests',
  (SELECT string_agg(payload, ',' ORDER BY payload) FROM rls_fixture.tenant_item WHERE tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 'B-1,B-2');
SELECT rls_test.expect('S3 no role other than the bootstrap superuser is superuser or BYPASSRLS',
  (SELECT count(*) FROM pg_roles WHERE (rolsuper OR rolbypassrls) AND rolname <> current_user AND rolname NOT LIKE 'pg\_%') = 0);
SELECT rls_test.expect('S3 exactly one policy exists on the table, applying to ALL commands and to menlo_app only',
  (SELECT count(*) = 1 AND bool_and(polcmd = '*') AND bool_and(polroles = ARRAY['menlo_app'::regrole::oid]) FROM pg_policy WHERE polrelid = 'rls_fixture.tenant_item'::regclass));
SELECT rls_test.expect('S3 the app role owns no objects in this database',
  (SELECT count(*) FROM pg_class WHERE relowner = 'menlo_app'::regrole) = 0
  AND (SELECT count(*) FROM pg_namespace WHERE nspowner = 'menlo_app'::regrole) = 0
  AND (SELECT count(*) FROM pg_proc WHERE proowner = 'menlo_app'::regrole) = 0);
SELECT rls_test.expect('S3 PUBLIC has no privileges on the fixture table',
  NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee = 'PUBLIC' AND table_schema = 'rls_fixture'));
