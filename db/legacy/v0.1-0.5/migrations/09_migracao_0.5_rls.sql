-- Menlo OS: migração 0.5 (endurecimento de isolamento entre clientes). Exige PostgreSQL 15 ou superior.
-- Achados do teste com usuário comum (sem superusuário):
--  1) As 6 views rodavam com a permissão do dono e ignoravam a RLS: um cliente via linhas de outro.
--  2) A tabela tenant não tinha RLS: um cliente via a lista de todos os clientes.
SET search_path = menlo, public;

-- 1. Views passam a rodar com a permissão de quem consulta (e portanto sob a RLS dele).
DO $$
DECLARE v text;
BEGIN
  FOR v IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='menlo' AND c.relkind='v'
  LOOP
    EXECUTE format('ALTER VIEW menlo.%I SET (security_invoker = true)', v);
  END LOOP;
END $$;

-- 2. tenant: cada cliente enxerga só a própria linha.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenant
  USING (id = nullif(current_setting('menlo.tenant_id', true), '')::uuid);
-- INSERT/UPDATE/DELETE em tenant ficam fora do papel de aplicação (só o dono do esquema, por migração ou provisionamento).
