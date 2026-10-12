-- Mutação: privilégio excessivo (TRUNCATE ignora o RLS). A suíte DEVE falhar.
GRANT TRUNCATE ON rls_fixture.tenant_item TO menlo_app;
