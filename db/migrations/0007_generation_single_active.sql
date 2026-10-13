-- 0007_generation_single_active: no máximo UMA execução de geração em andamento por tenant (ADR-020, adendo de segurança).
-- A segunda tentativa viola este índice no momento de abrir a execução; o código a converte em GenerationBusyError (erro claro, nada
-- gravado). Execuções abandonadas em `running` são recuperadas pelo código (prazo explícito), que as marca `failed` e libera o índice.
-- Só cria um índice parcial sobre tabela vazia ou pequena; não altera dados nem permissões.

CREATE UNIQUE INDEX generation_run_one_running_idx ON plataforma.generation_run (tenant_id) WHERE status = 'running';
