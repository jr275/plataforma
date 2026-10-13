# ADR-016: Dados do Search Console como primeira fonte real

**Status:** PROPOSED (2026-10-12). Nada aqui está aprovado nem implementado: não há migration, tabela, papel de banco nem carga de dados. O dono do produto indicou o site da RE/MAX como modelo inicial e disse ter acesso ao Search Console e à API (chat, 2026-10-12). O que segue é proposta para aprovação item a item.

## Contexto

- A RE/MAX é o primeiro tenant (piloto). Tudo que é de imóvel ou RE/MAX fica em `packs/real-estate`; o núcleo é genérico (regra 10 do `CLAUDE.md`).
- Já existe um extrator em `packs/real-estate/analytics/gsc/gsc_semanal.py` (Python, leitura do Search Console pela API, login do dono pelo navegador) que gera três séries diárias em CSV: sem marca por dia e página, total por dia e só marca por dia. A lista de marca (`MARCA_REGEX`) é uma **proposta que a RE/MAX ainda precisa aprovar**.
- O extrator **não traz as consultas** (só as dimensões data e página), mas a tela Search Universe precisa de consultas.
- O carregador `load_gsc.py` existente **não serve ao novo modelo**: grava no esquema antigo `menlo.*` (que não existe aqui; ADR-011 e o baseline novo) e define o tenant com `set_config('menlo.tenant_id', …, false)`, ou seja, para a **sessão inteira**, e roda "como dono do esquema". O ADR-013 exige contexto de tenant só por transação, papéis separados e nenhum papel de aplicação como dono.
- Pendências herdadas: o papel do carregador Python (ADR-013, item 5) e as verificações do Neon (item 4) seguem em aberto.

## Decisão proposta

### 1. Fronteira do pack
Marca, parsing de cidade e qualquer termo de imóvel ficam em `packs/real-estate`. As tabelas do núcleo são genéricas (`search_*`), sem termos de domínio. A lista de marca é **dado de configuração por tenant**, com data de aprovação registrada; sem aprovação, as séries "sem marca" e "só marca" são marcadas como provisórias.

### 2. Tabelas (migrations futuras, só depois da aprovação)
| Tabela | Conteúdo |
| --- | --- |
| `plataforma.search_site` | propriedade do Search Console do tenant (`sc-domain:…` ou prefixo de URL), rótulo, padrão de marca e data de aprovação do padrão |
| `plataforma.search_page_daily` | `tenant_id`, `site_id`, `date`, `page`, `is_brand`, `clicks`, `impressions` (as séries que o extrator já gera) |
| `plataforma.search_query_period` | `tenant_id`, `site_id`, `period_start`, `period_end`, `query`, `is_brand`, `clicks`, `impressions`, `position`: agregado por consulta num período (alimenta o Search Universe) |

Todas com `tenant_id NOT NULL`, RLS forçada e a política canônica de tenant (gate do ADR-013), chave primária que torna a carga idempotente. Sem coluna de nota composta (regra 5). Dados pessoais: o Search Console já anonimiza consultas raras; o que ele devolver é o que se guarda, nada além. Nada disso entra em prompts (regra 7).

### 3. Quem escreve
Um papel novo e estreito, `plataforma_loader`, com `INSERT`/`UPDATE` só nas tabelas `search_*` e nenhum outro privilégio; sem superusuário, sem `BYPASSRLS`, não é dono de nada. Exige **emenda ao ADR-013** (taxonomia de papéis) e testes de catálogo para o papel novo. A carga define o tenant **por transação** (`SET LOCAL` equivalente), nunca na sessão, e o DSN vem de variável de ambiente, nunca de argumento de linha de comando.

### 4. Extrator e carregador
- Extrator: acrescentar o modo "por consulta" (agregado por período), mantendo a execução local do dono por ora (ADR-010: o agendador do repositório fica para depois). Credenciais (`client_secret.json`, `token.json`) **nunca** entram no repositório nem passam por mim.
- Carregador: **reescrito** para o esquema `plataforma`, com upsert idempotente, contexto de tenant por transação e papel `plataforma_loader`. O `load_gsc.py` atual fica marcado como legado.
- Só leitura do Search Console. A Google Indexing API **não** é usada para imóveis (regra 8).

### 5. Leitura e telas
Funções tipadas em `packages/api` (por `withTenant`): séries por dia, consultas por período com filtros. As telas Search Universe e Analytics passam a usá-las, no lugar das fixtures, **só quando** houver banco (Neon), tenant criado por operação administrativa e login com a claim de tenants (ADR-015).

### 6. Ordem de trabalho
1. Banco no Neon criado e verificado (ADR-013, item 4).
2. Tenant `remax` criado por operação administrativa (fora das migrations).
3. Migrations das três tabelas e testes de isolamento entre dois tenants.
4. Papel `plataforma_loader`, emenda ao ADR-013 e testes de catálogo.
5. Carregador reescrito e extrator por consulta.
6. Funções de `packages/api` e telas.

## Alternativas rejeitadas
- **Reaproveitar o `load_gsc.py` como está:** depende de um esquema que não existe e de contexto de sessão, o que quebra o isolamento.
- **Carregar como dono do esquema ou como `menlo_app`:** o dono pode contornar políticas e a aplicação não deve escrever dados de carga.
- **Guardar uma linha por consulta, página e dia:** volume alto sem tela que precise dele agora; começamos pelo agregado por período.

## Consequências
- Primeiro dado real do produto, sem dados pessoais.
- Depende do Neon, do tenant `remax` e de uma emenda de papéis; nada disso existe ainda.
- A aprovação da lista de marca pela RE/MAX continua pendente e afeta o que as séries significam.

## Decisões necessárias do dono do produto
1. Aprovar (ou ajustar) o modelo e os nomes das tabelas.
2. Propriedade do Search Console: domínio (`sc-domain:remax.com.br`) ou prefixo de URL.
3. A RE/MAX autorizou o uso desses dados no projeto, e a lista de marca foi aprovada por ela?
4. Guardar consultas por período (sim ou não) e por quanto tempo.
5. Aprovar o papel `plataforma_loader` (emenda ao ADR-013, item 5).
6. Primeiro período a carregar (o extrator cobre até 480 dias).
