# Migrations SQL (autoridade única do esquema)

Aqui vivem as migrations do produto, escritas à mão em SQL (ADR-011). O Drizzle **não** gera nem aplica migrations. Um diretório sem migrations é um estado válido e não significa que o esquema do produto esteja inicializado. A primeira fatia (ADR-014) tem duas migrations: `0001_tenant` (esquema `plataforma`, função de contexto e a tabela `tenant`, sem acesso da aplicação) e `0002_opportunity` (primeira tabela do data plane, com RLS forçada). Elas só foram aplicadas em cluster **descartável** (`pnpm test:schema`); nenhum banco persistente ou de produção recebeu o esquema.

O runner é `scripts/db-migrate.sh` (Bash + `psql`; nenhuma dependência nova). Os testes são `scripts/test-migrations.sh` (runner) e `scripts/test-security.sh` (verificações de catálogo), contra um PostgreSQL 16 descartável.

## Papéis (ADR-013)

| Papel | Função | Pode |
| --- | --- | --- |
| **Administrador** (dono do ledger) | roda `--init-ledger` **uma vez** por banco; é dono do esquema `plataforma_migrations`, do ledger e da tabela de lock | tudo sobre os metadados de migration; não é o executor |
| **Executor** | roda as migrations; é dono dos objetos de produto que elas criam | `SELECT` e `INSERT` no ledger, `UPDATE` em `run_lock` (só para o `LOCK TABLE`), `CREATE` nos esquemas de produto |
| **Aplicação** (`menlo_app`) | runtime | nada nos metadados de migration; só os grants explícitos que as migrations lhe derem |

Em ambientes **descartáveis**, `scripts/db-bootstrap.sh` (`pnpm db:bootstrap`) cria e **verifica** os três papéis (`plataforma_admin`, `plataforma_migrator`, `menlo_app`), o banco e o ledger (ver abaixo). Não há procedimento de produção.

O runner **recusa** executar (código 1) se o executor: for superusuário; tiver `BYPASSRLS`; for membro de qualquer papel; não tiver `TEMP` no banco; for dono ou membro do dono do ledger; tiver `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` ou `TRIGGER` no ledger; não tiver os privilégios mínimos; ou se o ledger não estiver inicializado, tiver estrutura diferente ou estiver com os gatilhos append-only ausentes ou desabilitados. O runner **não cria** o ledger no modo normal.

## Nome e numeração

- `NNNN_descricao.sql`: exatamente 4 dígitos, `_`, descrição em minúsculas, dígitos e `_` (começando por letra ou dígito), extensão `.sql` minúscula. Regex: `^[0-9]{4}_[a-z0-9][a-z0-9_]*\.sql$`.
- A numeração começa em `0001`, é contínua (sem lacunas) e única (sem duplicatas). O limite é `9999`.
- A ordem é numérica (o número é lido como inteiro decimal). Como a largura é fixa, ela coincide com a ordem lexicográfica; a regra existe para não depender dessa coincidência.
- O único arquivo permitido além das migrations é `README.md`. Qualquer outra entrada (outro nome, subdiretório, link simbólico) faz o runner falhar antes de conectar.

## Imutabilidade e checksum

- Checksum: **SHA-256 dos bytes exatos do arquivo**, em hexadecimal minúsculo (64 caracteres), sem normalização de espaços, finais de linha nem codificação.
- Uma migration **aplicada** nunca pode ser editada, removida, renomeada nem renumerada. Para corrigir, crie uma nova migration. O runner falha com código 1 se detectar qualquer uma dessas mudanças.
- Uma migration que falhou **não** foi aplicada (nada ficou registrado), e por isso pode ser corrigida e executada de novo.
- O runner copia cada arquivo para um diretório temporário privado e soma e executa **essa cópia**.

## Ledger e integridade (o que protege e o que não protege)

Tabela `plataforma_migrations.ledger`, criada por `--init-ledger` com o papel administrador:

| Coluna | Tipo | Regras |
| --- | --- | --- |
| `seq` | `integer` | chave primária; `1..9999` |
| `filename` | `text` | único; mesmo formato do nome; os 4 primeiros dígitos devem ser iguais a `seq` |
| `sha256` | `text` | 64 hexadecimais minúsculos |
| `applied_at` | `timestamptz` | `clock_timestamp()` |
| `applied_by` | `name` | `current_user` de quem aplicou |

Proteções, em camadas, e seus limites:

1. **Privilégios:** o executor só tem `SELECT` e `INSERT`; não consegue apagar, alterar, truncar, desabilitar gatilhos, ser dono nem conceder privilégios. A aplicação não tem acesso algum. Isso fecha o achado da Fase 5 (apagar a última entrada para forçar a reaplicação) **contra o executor e contra a aplicação**.
2. **Gatilhos append-only** (`UPDATE`, `DELETE`, `TRUNCATE` levantam erro), mesmo para o dono e para superusuário (privilégios são contornados por superusuário; gatilhos não). O runner recusa rodar se estiverem ausentes ou desabilitados.
3. **Validação do histórico:** ledger contínuo, e cada migration aplicada deve existir com o mesmo nome e o mesmo checksum.
4. **`--expect-head N[:SHA256]` (evidência independente, opcional):** o runner imprime `ledger head: N:SHA256` ao final. O operador guarda esse valor fora do banco (log do CI/deploy, segredo de ambiente) e o passa na próxima execução; se a cabeça do ledger for diferente, o runner falha antes de aplicar qualquer coisa.

**Limitação explícita:** um dono privilegiado (o administrador, um superusuário) pode contornar os gatilhos (`ALTER TABLE ... DISABLE TRIGGER`, `session_replication_role = replica`) e apagar as últimas entradas. Remover só as últimas linhas **não é detectável pelo próprio ledger**: as linhas restantes continuam consistentes, e um checksum ou uma cadeia de hashes sobre elas não muda isso. Sem `--expect-head`, o runner reaplica a migration. Por isso o modelo de confiança é: o administrador é confiável; o executor e a aplicação não são; e a evidência independente (`--expect-head`) fica fora do banco. Não foi adicionada cadeia de hashes nem outro mecanismo criptográfico porque nenhum modelo de ameaça aprovado o exige.

## Transações, lock e ordem de execução

1. Validação local, sem conexão: nomes, duplicatas, lacunas, conteúdo proibido (abaixo) e instantâneo dos arquivos.
2. Conexão por **uma única sessão** do `psql` (`ON_ERROR_STOP`).
3. Verificação do ledger e do papel executor; validação do histórico; `--expect-head`, se informado.
4. **Gate de linha de base** (`BEGIN; SET LOCAL search_path = pg_catalog, pg_temp; <gate>; ROLLBACK`): se o banco **já** viola as invariantes de segurança, nada é aplicado (código 1), mesmo sem migrations pendentes.
5. Cada migration pendente, em ordem, **numa única transação**: `BEGIN`; `LOCK TABLE plataforma_migrations.run_lock IN EXCLUSIVE MODE` (espera até `--lock-timeout`, padrão `30s`; passado o prazo, código `3`); revalida o histórico e reconfere sob o lock se a migration já foi aplicada; **executa o SQL da migration**; verifica que a migration não encerrou a transação; **`SET LOCAL search_path = pg_catalog, pg_temp` e roda o gate de segurança** (`db/checks/security_gate.sql`, ver `db/checks/README.md`); **só então insere a linha no ledger** e faz `COMMIT`. Qualquer falha (SQL, gate, ledger) desfaz tudo: a mudança de esquema e o registro são atômicos e a migration **não** é dada como aplicada antes do `COMMIT`. Nenhuma migration seguinte é executada.
6. Uma migration cujo checksum já consta no ledger é ignorada (`current`).

**Gate.** Ativo por padrão; exige `--app-role PAPEL` (e aceita `--global-allow esquema.tabela,...` para tabelas globais aprovadas). Só se desliga com `--no-security-gate` explícito (imprime um aviso; serve apenas aos testes do runner; nunca em produção). Rejeita a migration (código 1, mensagem `FALHA [security gate]`, linhas `not ok - ...`) e a desfaz se: o RLS de uma tabela do tenant for desligado ou deixar de ser forçado; uma política de tenant for removida ou enfraquecida; `PUBLIC` ganhar acesso a dados, esquemas ou sequências; a aplicação ganhar acesso aos metadados de migration, `CREATE`, `TRUNCATE`, `UPDATE` em sequências ou for dona de objeto; surgirem default privileges para a aplicação ou `PUBLIC`; uma view sem `security_invoker` ou uma `SECURITY DEFINER` ficar alcançável pela aplicação; uma tabela alcançável pela aplicação não tiver `tenant_id` e não estiver aprovada como global. O estado inicial **vazio** (sem esquema de produto) passa: a ausência de tabelas é vacuosa, não falha; os papéis e o ledger continuam sendo verificados. O gate falha fechado: papel da aplicação inexistente ou invariante não verificável vira erro.

**Alcance do gate (leia antes de confiar nele).** Ele inspeciona o catálogo real dentro da transação, mas roda com os privilégios do executor e é código do próprio runner: **não protege contra um administrador ou superusuário que possa alterar o gate, o runner, o ledger ou a configuração do banco**. Uma migration maliciosa do próprio executor não consegue falsificá-lo por tabelas temporárias nem por funções com nomes de catálogo (testado), mas o gate é uma proteção contra erros e mudanças inseguras revisáveis, não contra um insider privilegiado. `FORCE ROW LEVEL SECURITY` não protege contra o dono da tabela; o gate **detecta** o estado resultante. O gate também **não** autentica tenant: um `app.tenant_id` livremente definível continua não sendo identidade autenticada.

**Por que um lock de tabela e não `pg_advisory_lock`:** as funções de lock de aconselhamento são executáveis por `PUBLIC`; a aplicação conseguia tomar o lock do runner e bloqueá-lo (achado 2 da Fase 5), e `pg_locks` é legível por todos, o que expõe qualquer chave. Revogar `EXECUTE` dessas funções afetaria o banco inteiro e não foi usado. O lock agora é uma tabela (`run_lock`, vazia, que nunca recebe linhas) à qual só o executor tem acesso: o `LOCK TABLE ... EXCLUSIVE` exige `UPDATE`, e a aplicação não tem nem `USAGE` no esquema. O lock é de transação: sai no `COMMIT`/`ROLLBACK` e quando a conexão cai (testado: sucesso, falha de SQL, `pg_terminate_backend` e `SIGKILL` do `psql` do runner). SQL exato: `BEGIN; SET LOCAL lock_timeout = '<--lock-timeout>'; LOCK TABLE plataforma_migrations.run_lock IN EXCLUSIVE MODE; SET LOCAL lock_timeout = DEFAULT; ...; COMMIT`. Privilégio necessário: `UPDATE` na tabela (com só `SELECT`+`INSERT` o PostgreSQL nega o modo `EXCLUSIVE`, testado) e `USAGE` no esquema. O runner mantém uma única conexão e a transação aberta durante a migration (amostrado em 3 instantes); entre uma migration e outra o lock é solto e retomado, e a reconferência sob o lock garante que dois runners não apliquem a mesma migration. Dois runners concorrentes serializam em cada migration e o segundo reconfere sob o lock, então nenhuma migration é aplicada duas vezes. **Resíduos:** um superusuário ou o administrador ainda podem segurar o lock; uma consulta de aplicação ainda pode bloquear um DDL do executor sobre uma tabela de produto (espera de lock do próprio DDL, que não tem timeout aqui).

## Modelo de ameaça (leia antes de confiar no runner)

| Fonte da migration | Suportado? |
| --- | --- |
| 1. Código **revisado e confiável** | Sim: é o caso de uso |
| 2. SQL inseguro por **acidente** ou sintaxe não suportada (transação, metacomandos, comandos fora de transação) | Sim: falha fechada e nada persiste (testado) |
| 3. Arquivos **malformados** (vazios, bytes nulos, nomes fora do padrão, ledger divergente) | Sim: rejeitados antes de executar |
| 4. Autor **malicioso** / SQL intencionalmente hostil | **Não**: a migration roda com os privilégios do executor; o gate e o rollback reduzem erros e mudanças inseguras revisáveis, mas **não** tornam seguro executar SQL arbitrário hostil sob um papel privilegiado |
| 5. Administrador do banco ou superusuário **comprometido** | **Fora de escopo**: ele altera o gate, o runner, o ledger e a configuração |

As defesas abaixo reduzem o impacto de (2) e (3) e fecham classes de contorno conhecidas de (4) (metacomandos, controle de transação, estado de sessão), mas **não** são uma promessa para (4).

## Como o runner executa uma migration (invariantes testados em `pnpm test:hardening`)

- **O conteúdo da migration é TEXTO para o PostgreSQL, nunca um script do `psql`.** Cada arquivo é colocado num literal entre aspas de dólar (marcadores derivados do hash do conteúdo, verificados como ausentes do arquivo) dentro de `DO ... BEGIN EXECUTE <texto>; END`. O `psql` não interpreta metacomandos nem variáveis dentro de um literal; qualquer barra invertida vira texto que o servidor rejeita como erro de sintaxe. A varredura de linhas iniciadas por `\` e de controle de transação no início da linha é só um **aviso antecipado**, não um analisador SQL, e **não** é o mecanismo de proteção.
- **Atomicidade imposta pelo servidor.** `EXECUTE` roda dentro da transação do runner; `COMMIT`, `ROLLBACK`, `END`, `ABORT`, `SAVEPOINT`, `START TRANSACTION`, `BEGIN`, `PREPARE TRANSACTION`, um `CALL` de procedimento que confirma e os comandos que não rodam em transação (`CREATE INDEX CONCURRENTLY`, `VACUUM`, `CREATE DATABASE`, `ALTER SYSTEM`) são recusados pelo PostgreSQL. A transação continua sendo a do runner até o gate, o `INSERT` no ledger e o `COMMIT`. **Política:** controle de transação **não é suportado** em migrations; migration que o contenha falha, desfaz tudo e nada persiste. Isso substitui a "limitação conhecida" da Fase 7 (um `COMMIT` escondido antes confirmava o que estava antes dele); a guarda por `xid` ficou como defesa adicional.
- **O sucesso vem do estado confirmado.** `exit 0` exige código de saída 0 do `psql`, o marcador final **e** uma segunda conexão que lê o ledger depois que o `psql` terminou: o ledger no banco tem de conter exatamente as migrations do diretório (mesmos números, nomes e checksums) e cada uma tem de ter sido reportada exatamente uma vez. O `ledger head` impresso sai dessa leitura, não de texto impresso. As linhas `applied`/`current` só são impressas depois da verificação, e a saída de uma execução que falha não as repete.
- **Nenhum estado de sessão atravessa migrations.** Antes de cada migration: `DISCARD ALL` (fora de transação: zera parâmetros, objetos temporários, cursores, instruções preparadas e locks de sessão) e `search_path = pg_catalog, pg_temp` para os comandos do runner. A migration roda com o `search_path` **padrão do servidor** (por isso os nomes devem ser qualificados: o esquema `public` do banco bootstrapado é fechado); depois dela, `RESET ALL` e `search_path` fixo antes do gate. A função de validação do histórico é recriada em cada transação com os dados dos arquivos **dentro** dela (sem tabela temporária que uma migration possa substituir) e com `search_path` próprio.
- **`--no-security-gate` só vale num cluster descartável comprovado.** O runner exige que o arquivo `.disposable-pg-marker` do `--socket-dir` contenha um nonce igual ao do **servidor em execução** (parâmetro `plataforma.disposable_nonce`, definido ao iniciar o cluster descartável) e que o servidor não escute em rede; senão recusa (código 2). Um arquivo comum não casa com nenhum servidor. Isto evita acidentes; **não** protege contra um administrador local malicioso. Execuções **com** o gate (o padrão) não dependem do marcador.

## O que as migrations podem e não podem conter

- **Suportado:** qualquer SQL que o PostgreSQL aceite dentro de um bloco de transação.
- **Aviso antecipado (não é a proteção):** linhas que começam com `\` ou com controle de transação são rejeitadas antes de conectar. Arquivos vazios, só com espaços ou com bytes nulos também. A proteção real é a execução como texto num contexto atômico (acima).
- **Não suportado, recusado pelo PostgreSQL:** controle de transação e comandos que não rodam em transação. Não há fallback sem transação, e **nenhum** efeito dessas migrations persiste (testado).
- **Suportado:** SQL de várias instruções em que as seguintes dependem das anteriores (schema, tabelas, DML, `DO` aninhado), funções e procedimentos (sem `COMMIT` dentro), comentários (um arquivo só com comentários é um no-op válido). Saídas de `SELECT` dentro da migration são descartadas.
- **Regras de privilégio para quem escreve migrations (ADR-013):** nada de `ALTER DEFAULT PRIVILEGES` a favor da aplicação nem de `PUBLIC`; todo `GRANT` à aplicação é explícito, por objeto, na mesma migration que cria a tabela; toda tabela do tenant tem `tenant_id uuid NOT NULL`, RLS ligado e forçado e política que cita `tenant_id`. Quem aplica isso é `db/checks/catalog_security.sql` (veja `db/checks/README.md`).

## Falha e recuperação

| Código | Significado |
| --- | --- |
| `0` | sucesso |
| `1` | falha de integridade, de validação, de papel/ledger ou de SQL (a mensagem diz a migration e a etapa) |
| `2` | uso incorreto ou pré-requisito ausente |
| `3` | tempo esgotado esperando o lock |
| `4` | falha de conexão ou perda da conexão |

Em falha de SQL, a migration é desfeita; corrija o arquivo (ainda não aplicado) e execute de novo. Isso vale **para aquele banco**: antes de editar uma migration que possa ter sido aplicada em outro ambiente, siga `docs/POLITICA_DE_ENGENHARIA.md` (verificar todos os ambientes e classificar o estado da migration). Em inconsistência de histórico, **nada é aplicado**; restaure o arquivo original ou investigue com decisão humana. O runner nunca altera nem apaga linhas do ledger.

## Como executar

Testes locais, em PostgreSQL 16 descartável (cada um cria o cluster, roda os testes e apaga tudo):

```bash
pnpm test:migrations   # runner: histórico, transações, lock, concorrência (gate desligado de propósito)
pnpm test:bootstrap    # papéis reais e sabotagens
pnpm test:gate         # gate transacional
pnpm test:security     # verificador de catálogo
```

Pré-requisitos das suítes (nenhuma instala nada). A falta dos binários do PostgreSQL 16 ou do `openssl` sai com código 2 e uma mensagem; a falta do `pgrep` não tem código próprio: o `MIG-K10` falha uma asserção e a suíte sai com código 1. Em nenhum caso a suíte termina com sucesso. Pré-requisitos: binários do PostgreSQL 16 (`initdb`, `pg_ctl`, `psql`; ver `RLS_HARNESS_PG_BIN_DIR` em `db/test-fixtures/rls/README.md`), `bash`, `openssl` (SHA-256 independente dos testes `MIG-N2` e `MIG-L10`: o runner usa `sha256sum`/`shasum`, e o teste usa outra implementação de propósito) e `pgrep` (o `MIG-K10` mata o `psql` do runner com `SIGKILL`). Em contêineres mínimos instale `openssl` e `procps`. Observação do `MIG-K10`: depois do `SIGKILL` o servidor só libera o lock quando a instrução em andamento termina (`client_connection_check_interval` é 0 por padrão), então o teste espera por condição, com prazo de 20 s, e não por número de iterações.

Invocação do runner (configuração explícita; variáveis `PG*` e `DATABASE_URL` do ambiente são **ignoradas**; só socket Unix, sem TCP e sem senha):

```bash
# uma vez por banco, como o administrador (dono do ledger):
pnpm db:migrate --init-ledger --executor PAPEL_EXECUTOR --socket-dir /abs/socket --port 5432 --dbname NOME --user PAPEL_ADMIN
# a cada execução, como o executor:
pnpm db:migrate --socket-dir /abs/socket --port 5432 --dbname NOME --user PAPEL_EXECUTOR --app-role menlo_app [--global-allow esq.tab] [--expect-head N:SHA256]
```

**Não foi executado contra nenhum banco persistente** e não há invocação de produção definida.

## Decisões pendentes (produção)

- Papéis reais de produção: o bootstrap só cobre clusters descartáveis (exige o marcador do cluster de teste); nenhum papel de produção foi definido ou criado, e o procedimento de produção (autenticação, `REVOKE` em escopo de banco, papéis gerenciados) não existe.
- Como o runner chega a um banco remoto (TLS, senha, identidade, Neon): não decidido nem implementado. O Neon pode restringir ações do administrador: não verificado.
- Onde guardar o valor de `--expect-head` (ele só é evidência independente se vier de uma fonte confiável **fora do banco** mutável, por exemplo o log do deploy anterior ou um segredo de ambiente) e se o CI/deploy o exige.
- Dados semeados sob RLS (o executor, sendo dono sob `FORCE`, não consegue inserir em tabelas com RLS; `BYPASSRLS` é recusado pelo runner): decisão pendente.
- Onde e quando as migrations rodam (CI, deploy, manualmente) e quem aprova.
