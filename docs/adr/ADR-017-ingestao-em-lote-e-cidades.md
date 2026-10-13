# ADR-017: Ingestão em lote e a primeira entidade (cidade)

**Status:** ACCEPTED (2026-10-12). O dono do produto aprovou no chat ("ok") as três tabelas, as regras de classificação (dígito verificador como aviso), o tenant `remax` / "RE/MAX (piloto)" e o limite de 20.000 linhas por execução. Fonte dos fatos de cidade: IBGE.

## Contexto
- Etapa 2 do MVP (`docs/audits/MVP_BASELINE_2026-10-12.md`): importar um CSV de cidades com campos mapeáveis, validar, registrar origem, horário e erro **por registro**, e distinguir dado real, de teste e manual. O Search Console **não** traz fatos de cidade (hipótese H2 do baseline); o IBGE traz.
- **Dados reais verificados em 2026-10-12** (API de localidades e SIDRA, tabela 6579, variável 9324): 5.571 municípios, código de 7 dígitos único, 27 UFs, 5 regiões, população estimada de 2026 para todos. **Casos de qualidade encontrados:** 1 município (`5101837`, Boa Esperança do Norte) **sem microrregião** (a UF e a região vêm da região imediata); e **9 códigos cujo dígito verificador não confere** (por exemplo `2201919`, `2201988`, `2202251`), todos municípios legítimos. Rejeitar por dígito verificador descartaria cidades reais.
- O modelo de tenant exige `tenant_id`, RLS forçada e a política canônica em toda tabela acessível à aplicação (ADR-013); migrations nunca semeiam dados.

## Decisão proposta

### 1. Três tabelas (migrations `0003` e `0004`)
Todas com `tenant_id NOT NULL` referenciando `tenant`, RLS forçada, política canônica, sem `DELETE` para a aplicação.

| Tabela | Colunas principais | Privilégios da aplicação |
| --- | --- | --- |
| `import_run` | `id`, `tenant_id`, `kind` (`csv`), `source_name`, `file_name`, `file_sha256`, **`origin` (`real`, `test`, `manual`)**, `mapping` jsonb (coluna de origem → campo), `status` (`running`, `succeeded`, `partial`, `failed`), `total_rows`, `accepted_rows`, `rejected_rows`, `duplicate_rows`, `error`, `started_at`, `finished_at`, `created_by` | `SELECT`, `INSERT`, `UPDATE` (fechar a execução) |
| `import_record` | `id`, `tenant_id`, `run_id`, `row_number`, `raw` jsonb (linha como lida), **`outcome` (`accepted`, `rejected`, `duplicate`)**, `issues` jsonb (lista de `{field, code, severity, message}`), `entity_id` | `SELECT`, `INSERT` (**imutável**: é o histórico) |
| `city` | `id`, `tenant_id`, `ibge_code` (7 dígitos, **único por tenant**), `name`, `uf`, `region`, `population`, `population_year`, `source_run_id` | `SELECT`, `INSERT`, `UPDATE` (reimportar atualiza, não duplica) |

### 2. Regras de classificação (100% das linhas classificadas, sem descarte silencioso)
- `accepted`: passa em todas as regras obrigatórias. `rejected`: falha em alguma, com **todos** os motivos. `duplicate`: o mesmo `ibge_code` já apareceu antes no mesmo arquivo (a primeira ocorrência vale).
- **Erros** (bloqueiam a linha): campo obrigatório ausente (`ibge_code`, `name`, `uf`), `ibge_code` fora de 7 dígitos, UF inexistente, região fora das 5, população não inteira ou negativa, ano fora de 1900 a 2200.
- **Avisos** (`severity: warning`, **não** bloqueiam e ficam registrados): dígito verificador do código IBGE que não confere (existem 9 casos reais).
- Mapeamento explícito: `{ campo → nome da coluna }`. Coluna obrigatória ausente no cabeçalho **falha a execução antes de processar**.
- Estado final: `succeeded` (tudo aceito), `partial` (há rejeitadas ou duplicadas e ao menos 1 aceita), `failed` (erro de execução, nada aceito ou arquivo inválido).

### 3. Ciclo de vida e recuperação
Três transações curtas por execução: (1) abre `import_run` como `running` e confirma; (2) grava todas as `import_record`, faz o upsert das cidades aceitas e fecha a execução, tudo atômico; (3) se a etapa 2 falhar, uma transação separada marca `failed` com o erro (sem segredos). Execução presa em `running` é identificável e reprocessável. Limite de linhas por execução (proposta: 20.000) para limitar a transação.

### 4. Código e fonte
Importador em TypeScript (`packages/api/src/ingest`), sem dependência nova (leitor de CSV próprio, com aspas, quebras de linha e `;` ou `,`). O CSV do IBGE é gerado por um script de busca (`scripts/fetch-ibge-cities.mjs`) a partir das APIs públicas; o arquivo bruto **não** entra no Git (só um fixture pequeno de linhas reais e casos inválidos); o `sha256` fica na execução. Dados do IBGE são abertos e públicos.

### 5. Tenant e tela
A carga real usa o tenant `remax` (piloto), criado por operação administrativa fora das migrations. A tela **Fluxo de dados** lê estas tabelas por funções de `packages/api`; ligá-la exige um acesso a dados no servidor do Next, com a identidade do login (ADR-015), que é a etapa seguinte.

## Alternativas rejeitadas
- **Rejeitar por dígito verificador:** descarta municípios reais.
- **Uma tabela só de cidades, sem histórico por linha:** perde a rastreabilidade pedida.
- **Dependência de biblioteca de CSV:** o formato necessário é pequeno e o risco de supply chain não compensa agora.

## Consequências
- Primeiro fato real do produto, com origem, horário e erro por registro; a rastreabilidade das páginas (etapas 3 a 5) parte de `city` e `import_record`.
- `raw` guarda a linha original; para fontes futuras com dados pessoais isso exige decisão própria (não se aplica ao IBGE).

## Decisões necessárias do dono do produto
1. Aprovar as três tabelas, os estados e as regras da seção 2 (inclusive o dígito verificador como aviso).
2. Slug e nome do tenant piloto (proposta: `remax`, "RE/MAX (piloto)").
3. Limite de linhas por execução (proposta: 20.000).
