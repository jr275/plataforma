-- Papéis do cluster DESCARTÁVEL do harness. Nunca aplicar em banco persistente.
-- Executado como o superusuário de bootstrap do cluster temporário.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rls_fixture_owner') THEN
    CREATE ROLE rls_fixture_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'menlo_app') THEN
    CREATE ROLE menlo_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;

-- Estado esperado, reafirmado a cada execução (o script de mutação pode alterá-lo).
ALTER ROLE rls_fixture_owner NOSUPERUSER NOBYPASSRLS;
ALTER ROLE menlo_app NOSUPERUSER NOBYPASSRLS;
