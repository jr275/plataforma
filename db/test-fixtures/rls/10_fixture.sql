-- Fixture de teste de RLS. Executado como o superusuário de bootstrap, num banco
-- recém-criado cujo dono é rls_fixture_owner. NÃO é migration de produto.

REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"dbname" TO menlo_app, rls_fixture_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA rls_fixture AUTHORIZATION rls_fixture_owner;
GRANT USAGE ON SCHEMA rls_fixture TO menlo_app;

SET ROLE rls_fixture_owner;

CREATE FUNCTION rls_fixture.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE rls_fixture.tenant_item (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL,
  payload   text NOT NULL
);

ALTER TABLE rls_fixture.tenant_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE rls_fixture.tenant_item FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON rls_fixture.tenant_item
  AS PERMISSIVE FOR ALL TO menlo_app
  USING (tenant_id = rls_fixture.current_tenant_id())
  WITH CHECK (tenant_id = rls_fixture.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON rls_fixture.tenant_item TO menlo_app;

RESET ROLE;

-- Dois tenants sem sobreposição (semeados pelo superusuário, que ignora o RLS).
INSERT INTO rls_fixture.tenant_item (tenant_id, payload) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A-1'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A-2'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B-1'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'B-2');

-- Helpers de asserção. SECURITY INVOKER: o SQL dinâmico roda com os privilégios de quem chama.
CREATE SCHEMA rls_test;
GRANT USAGE ON SCHEMA rls_test TO menlo_app, rls_fixture_owner;

CREATE FUNCTION rls_test.expect(name text, ok boolean) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE WHEN coalesce(ok, false) THEN 'ok - ' ELSE 'not ok - ' END || name $$;

-- Verdadeiro se o comando falhar com o SQLSTATE esperado. O efeito é desfeito (subtransação).
CREATE FUNCTION rls_test.raises(stmt text, expected_sqlstate text) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE s text;
BEGIN
  EXECUTE stmt;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE;
  RETURN s = expected_sqlstate;
END
$$;

-- Verdadeiro se o comando executar sem erro. O efeito é desfeito (subtransação).
CREATE FUNCTION rls_test.succeeds(stmt text) RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE stmt;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$$;

-- Linhas afetadas por um comando de escrita.
CREATE FUNCTION rls_test.rows_affected(stmt text) RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE n bigint;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA rls_test TO menlo_app, rls_fixture_owner;
