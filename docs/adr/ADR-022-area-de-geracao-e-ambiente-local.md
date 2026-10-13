# ADR-022: Área "Geração de páginas", segurança de execuções e ambiente local de desenvolvimento

**Status:** ACCEPTED (2026-10-13), implementado sob a diretiva do dono ("fechar a Etapa 4 e iniciar a primeira experiência visual"). Tudo é reversível e nada foi aplicado em banco persistente.

## Contexto
A auditoria de 2026-10-13 achou três defeitos na Etapa 4 (ids inexistentes sumiam, execuções ficavam presas em `running`, execuções concorrentes falhavam com erro cru de unicidade) e que a plataforma ainda não tinha uma tela real para gerar, inspecionar e reprocessar páginas. Os dados de imóveis não existem no modelo (ver "Bloqueio dos Imóveis").

## Decisão
1. **Segurança das execuções (migration `0007`, código em `generate.ts`).**
   - **Uma execução em andamento por tenant:** índice único parcial `generation_run_one_running_idx (tenant_id) WHERE status = 'running'`. A segunda tentativa é recusada com `GenerationBusyError` (id da execução ativa; nenhuma gravação). Tenants diferentes convivem.
   - **Execução abandonada:** `running` mais antiga que `staleAfterMinutes` (padrão 15) é recuperada para `failed` com o motivo "abandonada: sem fechamento em N minutos", antes de abrir a nova. Transições: `running → succeeded | partial | failed`, todas terminais. **O fechamento só vale se a execução ainda está `running`**: uma execução abandonada que volta a andar não consegue fechar, desfaz a própria transação e não deixa itens nem versões.
   - **Ids inexistentes:** o escopo por lista é conferido ANTES de abrir a execução; `GenerationScopeError` lista os ids que não existem e nada é gravado.
   - **Mínimo de 10 registros:** continua critério de aceite do lote piloto (`PILOT_MIN_VALID`, `meetsPilotAcceptance`), não uma proibição: reprocessar uma única página é permitido.
2. **Área `/generation` no aplicativo existente** (lista com busca, filtro, ordenação e paginação pela URL; detalhe da página com pré-visualização desktop/celular, resultado de busca, gates, fatos e fontes, fatos ausentes, versões; detalhe da execução; formulário de gerar; reprocessar). Reaproveita o design system e a casca existentes. Identidade e tenant vêm da sessão verificada (ADR-018); tabelas inexistentes viram o estado explícito `not_migrated`. **"Aprovar e publicar" fica desabilitado** com o motivo (publicação é a etapa 5). O template não tem campos editáveis, e a tela diz isso.
3. **Pool com socket Unix local** (`createAppPool`, `postgresql:///banco?host=/socket&user=...`): aceito **somente fora de produção**; a forma de rede continua exigindo TLS verificado. Serve ao ambiente local; não enfraquece o caminho de rede.
4. **Ambiente local (`pnpm dev:local`, `scripts/dev-local.sh`):** o mesmo cluster descartável dos testes (só socket, pasta temporária) com as 7 migrations, o tenant `remax`, o extrato REAL do IBGE de SP e os 20 rascunhos do piloto; escreve `apps/web/.env.development.local` só enquanto roda e apaga tudo ao encerrar. Não usa o Neon.
5. **Testes de interface e de servidor:** `vitest` no `apps/web` (mesma versão do pacote `api`, nenhuma biblioteca de teste de componentes): renderização no servidor, ações do servidor, resolução de tenant e de identidade, com mocks só nas fronteiras (sessão, pool e execução). A classificação de "tabela inexistente" (`isUndefinedTable`, SQLSTATE 42P01) vive em `packages/api` para ser testada contra erros reais do PostgreSQL. A CI passa a rodar `pnpm turbo test`.
6. **Rota `/dev/preview`:** só em desenvolvimento (`notFound()` em produção); aplica o motor e os gates reais ao extrato real do IBGE, sem persistir, e rotula isso na tela. Existe para inspecionar a interface sem login nem banco.

## Alternativas rejeitadas
- **Trava consultiva (`pg_advisory_lock`) por tenant:** `menlo_app` ainda pode executar funções de lock no Neon (risco já aceito só em desenvolvimento); o índice parcial é imposto pelo próprio banco e não depende de papel.
- **Habilitar TLS desligado ou `sslmode=disable` para uso local:** enfraqueceria o caminho de rede; o socket Unix não passa pela rede.
- **Banco local persistente com TCP:** os scripts de bootstrap só aceitam cluster descartável sem rede, por desenho.

## Bloqueio dos Imóveis (não implementado, de propósito)
Não existe entidade, tabela, tipo nem fonte de dados de imóveis (o Menlo Studio mostrou apenas provedores `mock_mls` declarados como demonstração). Criar a tela de "Imóveis" agora exigiria dados fictícios, o que as regras do projeto proíbem. **Menor extensão compatível com o modelo multi-tenant:** (a) uma fonte real e autorizada (arquivo ou feed da RE/MAX); (b) migration `property` com `tenant_id`, RLS forçada, FK composta para `city`, `source_run_id` ligado a `import_run` (origem real/teste/manual) e os campos que a fonte realmente tiver (endereço, tipo, área, quartos, banheiros, preço, situação), sem DELETE para a aplicação; (c) importação pelo mesmo `runCityImport`/`import_record` generalizado por tipo; (d) a camada de anúncios (`listing`) separada, em fatia própria; (e) a tela de Imóveis só depois, sobre essas funções. Decisão do dono necessária: qual é a fonte.

## Consequências
- Etapa 4 passa a ter proteção real contra execuções órfãs, concorrentes e escopos inválidos, com testes de regressão e mutação.
- A migration `0007` precisa ser aplicada junto de `0005` e `0006` (nesta ordem) para a área funcionar no Neon.
- O limite de 15 minutos é uma escolha explícita e configurável por chamada.
