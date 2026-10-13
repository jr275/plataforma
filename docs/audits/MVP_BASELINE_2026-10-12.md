# Baseline do MVP de SEO programático

**Data:** 2026-10-12 · **Commit de referência:** `b6550c0` (`main`, CI verde no GitHub Actions) · **Natureza:** documento de linha de base. Diferencia **fatos verificados** (com evidência reproduzível) de **simulado**, **hipótese** e **lacuna**. Não promete resultado de SEO.

## 1. Estado inicial do repositório

| Item | Valor |
| --- | --- |
| Repositório | `jr275/plataforma`, branch `main`, HEAD `b6550c0` |
| CI do HEAD | `completed/success` (workflow `CI`, Ubuntu 24.04, PostgreSQL 16) |
| Alterações locais não commitadas na data | `docs/adr/ADR-016-dados-do-search-console.md` (novo) e uma linha em `docs/adr/README.md`: proposta de ADR anterior a este baseline, **fora do escopo deste commit** |
| Banco | **nenhum banco persistente existe**; só clusters PostgreSQL descartáveis em testes. Neon não foi criado (ver seção 7) |
| Deploy | site de demonstração na Vercel (`apps/web`, Root Directory `apps/web`), com login do Supabase validado em produção (relato do dono + redirecionamento conferido por fora) |

## 2. Funcionalidades comprovadas (fatos verificados)

| # | Afirmação | Evidência e como reproduzir |
| --- | --- | --- |
| F1 | Existem 2 migrations de produto (`0001_tenant`, `0002_opportunity`) e 2 tabelas (`plataforma.tenant`, `plataforma.opportunity`) | `ls db/migrations`; `grep -h "CREATE TABLE" db/migrations/*.sql` |
| F2 | As migrations aplicam, com gate de segurança ativo, em cluster descartável e reaplicar não muda nada | `pnpm test:schema` (27 verificações; rodado em 2026-10-12 antes dos commits `6c8d463`/`875d385` e passou na CI Linux) |
| F3 | Isolamento entre dois tenants na tabela `opportunity`: leitura, escrita, `UPDATE` cruzado, mudança de tenant, `DELETE` negado, sem contexto = 0 linhas | mesmo `pnpm test:schema` e `packages/api/src/opportunities.product.test.ts` |
| F4 | `withTenant` isola por transação, valida o `COMMIT`, controla a conexão e descarta a que teve erro | `packages/api/src/tenant-context.*.test.ts`; `pnpm test:api` (33) e testes unitários (119 no total em `packages/api`) |
| F5 | Autenticador de token do Supabase no servidor (assinatura, emissor, audiência, expiração, papel, claim de tenants) | `packages/api/src/auth/supabase.test.ts` (sem rede; 6 mutações detectadas) |
| F6 | Login com o Supabase real funciona no navegador e no deploy; sem sessão, o site redireciona para `/login` | relato do dono (2026-10-12) e `curl -I` no site público devolve 307 para `/login` |
| F7 | A interface **não importa** `packages/api` | `grep -rn "@plataforma/api" apps/web/src apps/web/package.json` retorna 0 linhas |
| F8 | Todo dado das telas vem de fixtures | `apps/web/src/data/source.ts` só importa `./demo/aurora` e `./demo/northgate` |
| F9 | O repositório não tem ingestão, template de página, compilador de SEO, publicação nem fila de jobs | buscas de texto em `apps/ packages/ packs/ db/migrations scripts/`: `schema.org`/JSON-LD 0, `sitemap` 0, `recipe`/`archetype`/`page_type` 0, `dedup`/resolução de entidades 0; `canonical` e `robots` só em fixtures e no `noindex` do layout |
| F10 | Os "gates" existentes validam **segurança de banco**, não SEO | `db/checks/security_gate.sql` |
| F11 | Existe um extrator do Search Console em Python e um carregador **incompatível** com o esquema atual | `packs/real-estate/analytics/gsc/`; `grep -c "menlo\." load_gsc.py` = 12 (esquema legado `menlo.*`, contexto de tenant de **sessão**) |

## 3. Funcionalidades simuladas (só interface)
Conhecimento, entidades, páginas, buscas, agentes, templates, achados de pesquisa, quality gates, analytics, "fontes", execução de agentes, respostas do Ask AI, "conectar fonte" e a prévia programática: todos operam sobre fixtures e estado do navegador (localStorage), sem banco, sem API real e sem integração externa. A tela de oportunidades **não** usa a tabela `opportunity`.

## 4. Hipóteses (não verificadas)
- **H1.** O extrator do Search Console funciona com a propriedade da RE/MAX. O código existe; **não foi executado nesta auditoria**. O README do pack registra permissão "restrita" na propriedade, o que pode causar erro 403.
- **H2.** O Search Console fornece o necessário para o template de cidade. **Provavelmente não**: ele devolve consultas, páginas e métricas de desempenho, **não** os fatos da cidade (população, bairros, preços, etc.). Os fatos precisam vir de outra fonte (CSV de cidades). Isso condiciona o aceite do MVP.
- **H3.** A lista de marca (`MARCA_REGEX`) está aprovada pela RE/MAX. O código a chama de "proposta".
- **H4.** O Neon aceita a taxonomia de papéis do ADR-013 (administrador, executor, aplicação) e o runner com gate. **Não verificado** (ADR-013, item 4).
- **H5.** O volume e a latência do Search Console por consulta cabem no plano da API sem tratamento de limites.

## 5. Lacunas por subsistema

| Subsistema | Estado | Lacuna principal |
| --- | --- | --- |
| Knowledge Infrastructure | só interface | conectores, mapeamento, entidades persistidas, deduplicação, proveniência |
| Search Opportunity Engine | parcial mínimo | tabela e 3 funções existem; falta descoberta, clusters, intenção, canibalização, estimativa; tela não usa o banco |
| Programmatic Page Engine | só interface | template executável, contrato de dados, versionamento, geração reproduzível |
| SEO Compiler & Quality Gates | ausente | validação de metadados, canonical, links, JSON-LD, duplicidade, bloqueio |
| Publishing & Indexation | ausente | aprovação, publicação, sitemap, atualização sem duplicar URL, rollback |
| SEO & GEO Observability | parcial fora do produto | extrator existe; carregador legado; nada chega à interface; GA4 e GEO ausentes |
| Automation & Agents | só interface | fila de jobs, estado persistente, reprocessamento, auditoria |
| Multi-tenant Control Plane | parcial forte | isolamento e login prontos; faltam organizações, membros, permissões, quotas, credenciais, auditoria |

## 6. Critérios de aceite do MVP
Definidos pelo dono em 2026-10-12 (7 etapas bloqueadoras e métricas de engenharia); este documento os adota sem alterá-los. Cada etapa precisa de evidência reproduzível; "tela existe" não é prova.

1. **Infraestrutura e Neon:** projeto acessível; schema só por migrations versionadas; reaplicação sem inconsistência; conexão fora do repositório; isolamento testado em leitura e escrita; tratamento de falha de conexão e de migration.
2. **Ingestão e Search Console:** CSV de cidades com mapeamento; validação de obrigatórios, tipos, duplicatas; origem, horário e erro por registro; OAuth da propriedade autorizada; consulta real por página e período; limites, expiração e ausência de dados; distinguir real, teste e manual.
3. **Template de cidade:** executável, com versão, campos documentados, sem preenchimento fictício, duas cidades com conteúdo factual diferente, regras explícitas para título, meta, headings, URL e links; atualização sem duplicar URL.
4. **Geração em lote e gates:** ao menos 10 registros válidos; execução registrada; repetição sem duplicar; bloqueio só dos registros inválidos; detecção de ausência de campo, URL duplicada, metadado inválido, link quebrado; reprocessamento sem perder histórico.
5. **Publicação controlada:** preview; aprovação explícita; status HTTP e URLs estáveis; canonical, links e regras de indexação; sitemap só com URLs elegíveis; atualização sem nova URL; recuperação ou reversão testada; ambiente de teste sem indexação acidental.
6. **Medição:** impressões, cliques, CTR e posição por propriedade, página e período; ausência de dado diferente de zero; última sincronização e falhas; páginas de teste separadas das de produção; indexação só com evidência.
7. **Segurança e operação:** testes de autorização entre organizações; nenhum segredo em log ou commit; trilha de auditoria de publicação; jobs recuperáveis; testes ponta a ponta; build e verificações passando; documentação reproduzível.

**Métricas:** 100% dos registros importados classificados (sem descarte silencioso); ≥ 10 registros em lote; 100% das páginas publicadas passam nos gates críticos; zero URLs duplicadas pelo pipeline; zero falhas de isolamento nos testes definidos; 100% das execuções com estado e histórico; métricas conciliadas com a fonte para a mesma propriedade, período e dimensões. **Sem meta de impressões, cliques, posição ou indexação.**

**Teste final (10 itens):** importar ≥ 10 cidades; consultar desempenho no Search Console; gerar páginas distintas; introduzir um registro inválido e comprovar que não publica; aprovar explicitamente; acessar URLs e verificar HTML, canonical, links e sitemap; alterar um dado e atualizar sem duplicar; consultar métricas reais com a última sincronização; tentar acessar outro tenant e comprovar a negação; simular falha e reprocessar.

## 7. Acesso ao Neon (verificado em 2026-10-12)
- Não há `neonctl` instalado, nem variável `NEON_*` ou `DATABASE_URL` no ambiente da sessão, nem ferramenta do Neon disponível. **A criação do projeto não pôde ser feita** e **não há banco para validar**.
- O repositório não tem configuração de Neon: só a menção em `CLAUDE.md`/ADRs e a dependência `@neondatabase/serverless` em `packages/db`. Nenhuma configuração funcional foi tocada.
- Pré-requisitos para a etapa 1: projeto Neon com PostgreSQL 16 criado pelo dono (ou autorização para uso de uma credencial protegida), conexão guardada só em variável de ambiente, papéis conforme ADR-013 (item 4 ainda a verificar no Neon: lock de aconselhamento, ledger, TLS).

## 8. Roadmap do MVP (dependências e pontos de decisão)

| # | Entrega | Depende de | Aceite (resumo) |
| --- | --- | --- | --- |
| 0 | Baseline e ADRs de modelo | este documento | revisado e commitado |
| 1 | Neon + papéis + migrations + tenant `remax` | acesso ao Neon, ADR-013 item 4 | critérios da etapa 1 |
| 2 | Fatos de cidade (CSV) e Search Console | 1, **fonte dos fatos de cidade (H2)**, OAuth, aprovação de marca (H3) | critérios da etapa 2 |
| 3 | Template de cidade versionado | 2 | critérios da etapa 3 |
| 4 | Geração em lote e quality gates | 3 | critérios da etapa 4 |
| 5 | Aprovação e publicação num site de teste | 4, **decisão sobre o site e o mecanismo de publicação** | critérios da etapa 5 |
| 6 | Medição ligada às URLs publicadas | 2, 5 | critérios da etapa 6 |
| 7 | Segurança, operação e documentação | todas | critérios da etapa 7 e teste final |

**Decisões pendentes do dono:** projeto Neon; fonte dos fatos de cidade; propriedade do Search Console e permissão completa; aprovação da lista de marca pela RE/MAX; site e mecanismo de publicação de teste; papel do carregador (ADR-013 item 5); retenção de consultas.

## 9. Limites desta auditoria
Leitura estática do repositório e buscas de texto, mais testes executados nas datas indicadas. Nenhuma jornada de ponta a ponta foi executada porque nenhuma existe. Buscas por palavra podem não achar código com outro nome. O extrator do Search Console e o fluxo OAuth **não** foram executados.
