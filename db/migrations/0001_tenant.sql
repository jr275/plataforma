-- 0001_tenant: esquema do produto, função de contexto de tenant e a tabela raiz `tenant` (ADR-014).
-- Esta migration NÃO semeia dados de tenant (ADR-013, item 3): tenants são criados por uma operação administrativa fora das
-- migrations e fora do runtime.

CREATE SCHEMA plataforma;
GRANT USAGE ON SCHEMA plataforma TO menlo_app;

-- Forma canônica exigida pelo gate de segurança (db/checks/README.md): corpo com aspas comuns, SQL, STABLE, SECURITY INVOKER.
CREATE FUNCTION plataforma.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE
AS $q$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $q$;
REVOKE ALL ON FUNCTION plataforma.current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION plataforma.current_tenant_id() TO menlo_app;

-- Raiz dos tenants. A aplicação NÃO recebe privilégio algum sobre esta tabela: ela não tem a coluna `tenant_id` que o gate
-- exige das tabelas acessíveis à aplicação, e nenhuma função de API precisa lê-la. Sem RLS de propósito: FORCE faria as
-- verificações de chave estrangeira (executadas com o dono da tabela) deixarem de enxergar as linhas.
CREATE TABLE plataforma.tenant (
  id         uuid        PRIMARY KEY,
  slug       text        NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name       text        NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE plataforma.tenant FROM PUBLIC;
