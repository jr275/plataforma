-- Mutação: política permissiva demais (USING/WITH CHECK true). A suíte DEVE falhar.
DROP POLICY tenant_isolation ON rls_fixture.tenant_item;
CREATE POLICY tenant_isolation ON rls_fixture.tenant_item
  AS PERMISSIVE FOR ALL TO menlo_app USING (true) WITH CHECK (true);
