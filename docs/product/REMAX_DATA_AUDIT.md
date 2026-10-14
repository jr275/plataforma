# Auditoria das fontes de dados da RE/MAX

Data: 2026-10-13. Base: `b49165b` mais as alterações locais da unidade Generation Hardening. Escopo: descobrir o que existe, está configurado e autorizado **antes** de conectar qualquer coisa. Nenhum valor de credencial foi lido, copiado ou impresso: só nomes de variáveis e se estão definidas.

## Resumo

| Fonte | Existe? | Acesso configurado e autorizado? | Situação |
|---|---|---|---|
| Municípios do IBGE (nome, UF, região, população) | Sim, é pública | Sim: já importada para o tenant `remax` no Neon (leitura) | **Real e em uso** |
| Search Console (`sc-domain:remax.com.br`) | Sim, segundo o dono | **Não verificado**: credenciais fora do repositório; permissão da conta descrita como "restrita"; sem tabelas nem carga | **Bloqueada** |
| Inventário de imóveis (preço, área, situação) | Não foi apresentada nenhuma fonte | Não | **Bloqueada** |
| Escritórios, corretores, equipes | Nenhuma fonte | Não; dados pessoais (regra 7, LGPD) | **Bloqueada** |
| Páginas e sitemaps do site atual | Público, **não inspecionado** | Não aplicável | Não inspecionada |
| GA4 | Nenhuma evidência de configuração | Não | **Bloqueada** |
| Citações e visibilidade em IA | Nenhuma fonte definida | Não | **Bloqueada** |
| Conteúdo e links internos existentes | Nenhuma fonte | Não | Não inspecionada |
| Provedor `mock_mls` do Menlo Studio | Existe como demonstração | Não é uma fonte real | **Descartada** (é mock) |

Conclusão: **o único dado real que a plataforma hoje consegue transformar em conhecimento são as cidades do IBGE.** Imóveis, desempenho de busca e entidades de negócio dependem de decisões, credenciais e autorizações do dono e não foram simulados.

## Configuração (somente nomes e presença)

| Arquivo (fora do Git) | Variável | Estado |
|---|---|---|
| `apps/web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | definidas (chave pública do Supabase; usada só para login) |
| `apps/web/.env.local` | `PLATAFORMA_APP_DATABASE_URL` | definida; **destino não verificado** (não imprimi o valor) |
| `.env.neon.local` | `NEON_OWNER_URL`, `NEON_ADMIN_URL`, `NEON_MIGRATOR_URL`, `NEON_APP_URL` | definidas (credenciais privilegiadas; não usadas nesta auditoria) |
| `apps/web/.env.development.local` | `PLATAFORMA_APP_DATABASE_URL` | existe só enquanto o `pnpm dev:local` do usuário roda; aponta para o banco local descartável |

Nenhuma variável de Search Console, GA4, imóveis ou IA está definida no projeto. O arquivo `.env.example` do aplicativo lista apenas as duas do Supabase.

Risco operacional registrado: se o aplicativo for iniciado **sem** `dev:local` e `PLATAFORMA_APP_DATABASE_URL` de `.env.local` apontar para o Neon, as ações de gerar e reprocessar escreveriam no Neon com o papel `menlo_app`. Convém confirmar o destino antes de usar a interface com sessão real.

## Modelo de tenant (verificado antes de ingerir)

- Tabela `plataforma.tenant`; todo registro do data plane tem `tenant_id NOT NULL`, RLS ligada **e forçada**, política `tenant_id = plataforma.current_tenant_id()`, chaves estrangeiras compostas e `UNIQUE (tenant_id, id)`.
- A aplicação usa o papel `menlo_app` (sem superusuário, sem `BYPASSRLS`, sem `DELETE`). O contexto de tenant é local à transação (`withTenant`). O tenant vem da claim assinada do usuário, nunca do formulário (provado por testes e mutações).
- Provas: `test:rls` 47 verificações (6/6 mutações), `test:security` 93, `test:schema` 79/79 e testes de produto com dois tenants, todos em PostgreSQL descartável.
- O tenant `remax` existe no Neon (`fce17b74-…`), confirmado por leitura como `menlo_app`: o contexto desse tenant enxerga 5.571 cidades e 20 páginas. **Não verificado:** a tabela `tenant` inteira e as associações de usuários (`menlo_app` não as lê); portanto não afirmo que existe um único tenant nem que as associações estão corretas. Nenhum tenant duplicado foi criado e nenhuma associação foi alterada.

## Fonte 1: Municípios do IBGE

1. **Existe:** sim. Dados públicos do IBGE (API de localidades e estimativa de população do SIDRA, agregado 6579, variável 9324), obtidos por `scripts/fetch-ibge-cities.mjs`.
2. **Acesso:** público; já importada no Neon pelo dono (`import_run` real, fonte `IBGE`, 5.571 linhas aceitas de 5.571, 5.571 `import_record`; verificado por leitura).
3. **Dono:** o IBGE. A RE/MAX não é dona do dado. A licença de uso formal não foi registrada neste projeto.
4. **Entidades e campos:** cidade com `ibge_code` (7 dígitos), `name`, `uf`, `region`, `population`, `population_year`.
5. **Atualidade e completude:** o extrato de SP no repositório é de 2026-10-12 (645 municípios, ano de referência 2026). O arquivo que gerou a carga de 5.571 cidades no Neon **não está no repositório**; só o `sha256` fica no `import_run`. Não comparei o conteúdo.
6. **Identificadores:** `ibge_code` é estável; o nome pode mudar de grafia.
7. **Frequência e método:** manual, por CSV e linha de comando (`ingest/cli.ts`, `scripts/neon-import-cities.sh`). Não há agendamento.
8. **Restrições:** nenhuma identificada por ser dado público; o termo de uso do IBGE não foi revisado aqui.
9. **Importação segura e reproduzível:** sim. 100% das linhas são classificadas (aceita, rejeitada, duplicada) e reimportar o mesmo arquivo não duplica (teste de produto).
10. **Falhas, duplicatas, exclusões e dados velhos:** falhas e duplicatas por linha ficam em `import_record`; **exclusões e atualização por mudança de fonte não são tratadas** (a `city` é atualizada no lugar, sem histórico).

Uso atual: base das páginas de cidade (`city-overview`), com fatos citáveis e proveniência.

## Fonte 2: Search Console

1. **Existe:** o dono afirma ter acesso (ADR-016, 2026-10-12). Há um extrator Python legado em `packs/real-estate/analytics/gsc/gsc_semanal.py`.
2. **Acesso configurado e autorizado:** **não verificado.** `client_secret.json` e `token.json` ficam fora do Git e não estão no repositório. O README registra que a permissão da conta na propriedade é "restrita" e que a API pode devolver 403 até a RE/MAX conceder permissão completa. Nenhuma variável de ambiente do projeto referencia o Search Console.
3. **Dono:** a RE/MAX (propriedade `sc-domain:remax.com.br`). A lista de marca (`MARCA_REGEX`) é uma proposta e precisa de aprovação da RE/MAX.
4. **Entidades e campos:** o extrator produz três séries diárias (sem marca por dia e página, total por dia, só marca por dia). **Não traz consultas**, que a tela Search Universe exigiria.
5. **Atualidade e completude:** sem dados no projeto. O export da interface só traz as 1.000 maiores páginas.
6. **Identificadores:** página (URL) e data. A cidade só é identificada por nome e UF (sem código IBGE); grafias diferentes viram entidades diferentes.
7. **Frequência e método:** extração local pelo dono; agendador do repositório ainda não existe (ADR-010).
8. **Restrições:** apenas leitura. A Google Indexing API **não** pode ser usada para imóveis (regra 8).
9. **Importação segura:** **ainda não.** O carregador legado `load_gsc.py` grava no esquema antigo `menlo.*` e define o tenant para a sessão inteira; foi marcado como inadequado (ADR-016). Não existem tabelas `search_*` nem o papel `plataforma_loader`.
10. **Falhas e dados velhos:** não definidos.

Dependências exatas: OAuth do dono; permissão completa na propriedade; aprovação da lista de marca; aprovação do ADR-016 (hoje PROPOSED); emenda ao ADR-013 (papel de carga); migrations novas (exigem autorização antes do Neon).

## Fonte 3: Inventário de imóveis

Nenhuma fonte foi apresentada. O documento `docs/proposals/PROPERTY_ENTITY_2026-10-13.md` lista o que falta: fonte real (arquivo, feed ou API da RE/MAX ou de quem o dono indicar, com uma amostra da estrutura), autorização documentada de quem detém os dados (termos, direitos sobre fotos, frequência) e política de dados pessoais. O provedor `mock_mls` do Menlo Studio se declara demonstração e **não** é fonte. Nenhum imóvel, preço ou disponibilidade foi criado ou simulado.

## Fontes 4 a 8

| Fonte | Evidência encontrada | Falta |
|---|---|---|
| Escritórios, corretores, equipes, áreas de atuação | Nada no projeto | Fonte e política de dados pessoais |
| Inventário de URLs, sitemaps e dados estruturados do site | Nada coletado. O site público não foi acessado nesta auditoria | Confirmação do dono sobre o domínio e o uso permitido; depois, leitura somente leitura de `robots.txt` e do índice de sitemaps |
| GA4 | Nenhuma variável, propriedade ou código | Propriedade e acesso |
| Conteúdo editorial e links internos | Nada | Fonte |
| Citações e visibilidade em IA | Nada | Fonte de medição autorizada |

## Outras pistas (não seguidas)

O registro de memória da sessão menciona outro projeto local (Wendy) com uma configuração de escopo do Search Console. Ele está **fora de `~/plataforma`**, não foi inspecionado nem usado e não será acessado sem autorização explícita do dono.

## O que a plataforma pode fazer hoje sem nova autorização

1. Telas reais de cidades (entidades) lendo `city` e a proveniência já gravada (leitura somente).
2. Grafo derivado **apenas** de relações presentes nas colunas da fonte (cidade → UF → região; cidade → página gerada); nenhuma aresta inventada.
3. Contratos de conector, validação e testes em banco descartável, sem fonte real.

## O que exige o dono (decisão ou credencial)

- Autorizar e fornecer o OAuth do Search Console (ou export), com permissão completa e a aprovação da lista de marca.
- Indicar e autorizar uma fonte real de imóveis (com amostra) e a política de dados pessoais.
- Decidir o site e o mecanismo de publicação (etapa 5).
- Autorizar migrations novas no Neon (ledger, ponto de restauração e verificação conforme `docs/runbooks/neon-dev.md`).
