-- Mutação: aplicação dona da tabela e sem FORCE (o dono ignora o RLS). A suíte DEVE falhar.
ALTER TABLE rls_fixture.tenant_item OWNER TO menlo_app;
ALTER TABLE rls_fixture.tenant_item NO FORCE ROW LEVEL SECURITY;
