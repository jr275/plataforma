-- Mutação: RLS desligado (a política continua existindo, mas não é aplicada). A suíte DEVE falhar.
ALTER TABLE rls_fixture.tenant_item NO FORCE ROW LEVEL SECURITY;
ALTER TABLE rls_fixture.tenant_item DISABLE ROW LEVEL SECURITY;
