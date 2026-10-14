# Critérios de aceite

Data: 2026-10-13. Complementa `docs/mvp-acceptance.md` (etapas do MVP, definidas pelo dono em 2026-10-12), que continua sendo a referência das etapas. Aqui: (1) estado de cada etapa com evidência; (2) a lista de verificação de "pronto" aplicada a cada fluxo; (3) critérios do slice em andamento.

## 1. Estado das etapas do MVP

| Etapa | Estado | Evidência | O que falta |
|---|---|---|---|
| 1. Infraestrutura e Neon | Atendida em essência; ledger não confirmado | Neon acessível; migrations versionadas; isolamento testado | Confirmar ledger e checksums |
| 2. Ingestão e Search Console | **Parcial**: ingestão de cidades atendida; Search Console bloqueado | 5.571 cidades importadas; ADR-016 PROPOSED | OAuth, permissão e aprovação do dono |
| 3. Template de cidade | Atendida | Testes de produto; duas cidades com conteúdo distinto | — |
| 4. Geração em lote e gates | Atendida (leitura do Neon: 20 rascunhos, 6 gates, 20 URLs) | `generation-*.product.test.ts` | Validação visual autenticada |
| 5. Publicação controlada | **Não atendida** (inexistente) | Botão desabilitado | Decisão do dono (site e mecanismo) |
| 6. Medição | **Não atendida** | — | Depende de 2 e 5 |
| 7. Segurança e operação | Parcial | Autorização entre tenants testada; trilha de auditoria de publicação inexistente; jobs síncronos | Auditoria, jobs recuperáveis, testes ponta a ponta com sessão real |

## 2. Lista de "pronto" por fluxo (aplicar a cada fatia)

1. O usuário inicia o fluxo pela interface ou por API documentada.
2. O servidor valida autenticação, permissão e tenant.
3. Entradas reais são validadas.
4. A lógica de negócio real executa.
5. Estado e resultado persistem quando necessário.
6. Erros e falhas parciais são visíveis e recuperáveis.
7. Há proveniência para toda saída factual.
8. Testes cobrem sucesso e falhas importantes.
9. A interface representa o estado real.
10. O resultado pode ser inspecionado e verificado de forma independente.

Um item só é "verificado" com o comando executado e o resultado registrado; verificação visual exige sessão real.

## 3. Critérios do slice 1: entidades reais e proveniência (WF4)

| ID | Critério | Como se prova | Estado |
|---|---|---|---|
| S1-1 | A lista mostra só cidades do tenant da sessão; `tenant_id` nunca vem do cliente | Teste de produto com dois tenants; teste de ação/carregador | Atendido (teste de produto com tenants K e L; carregador sem tenant do cliente) |
| S1-2 | Busca por nome (sem acento e sem diferenciar maiúsculas) ou código IBGE, filtro por UF, ordenação e paginação estáveis com empates | Teste de produto em PostgreSQL descartável | Atendido (produto: 645 cidades, sem acento, código, ordem e paginação sem repetir) |
| S1-3 | Página fora do intervalo não diz "sem cidades" | Teste de interface | Atendido (teste de interface; mutação W5 detectada) |
| S1-4 | O detalhe mostra atributos, a linha original, desfecho e motivos da validação, a execução de origem (fonte, origem, arquivo, `sha256`, horário) | Teste de produto e de interface | Atendido (produto e interface) |
| S1-5 | O detalhe liga à página gerada (URL, status, versão) quando existe, e declara "nenhuma página" quando não | Teste de produto | Atendido (produto: com e sem página) |
| S1-6 | As relações exibidas (UF, região) vêm só das colunas da fonte; nenhuma aresta inventada | Teste de produto e de interface | Atendido (produto: contagens por UF e região em amostra multi-UF; interface declara a origem das relações) |
| S1-7 | Identificador malformado é entrada inválida; cidade de outro tenant não existe e nada vaza | Teste de produto (dois tenants) | Atendido (produto: ids malformados e de outro tenant) |
| S1-8 | Estados próprios para sem sessão, sem tenant, banco não migrado, banco indisponível, falha de login e erro; nunca lista vazia no lugar de erro | Testes de interface e de carregador | Atendido (interface: 7 estados; carregador herda `loadForTenant`) |
| S1-9 | Somente leitura: nenhuma escrita, nenhuma migration; a tela aparece como dado real no cabeçalho | Inspeção do código e teste | Atendido (só `SELECT`; nenhuma migration; rótulo de dado real na navegação) |
| S1-10 | Mutações de segurança relevantes detectadas (tenant do cliente; erro vira lista vazia) | Teste de mutação em cópia isolada | Atendido (20 mutações, 20 detectadas) |
| S1-11 | Typecheck, lint, build (cópia isolada), testes web e de banco passam | Comandos executados e registrados | Atendido (`turbo typecheck lint build test --force` na cópia isolada; web 140; `test:schema` 79/79 com 86 testes de produto; `test:api` 33) |

Pendente por natureza: validação visual autenticada (exige sessão real do usuário) e leitura contra o Neon (não feita, sem autorização de conexão nesta unidade). Os critérios acima valem para o código e os testes; não declaram a tela verificada em produção.

## 4. Critérios gerais para aceitação do produto

O produto só entra em revisão de aceite quando: a matriz não tiver lacunas sem explicação; tudo no escopo estiver implementado e testado ou bloqueado por dependência externa documentada; os dados da RE/MAX fluírem pelo pipeline onde a fonte autorizada existir; o grafo refletir dados persistidos; a geração produzir pré-visualizações validadas a partir de conhecimento real; a publicação externa exigir autorização explícita; os agentes executarem fluxos reais e autorizados; segurança e isolamento estiverem verificados; e os riscos remanescentes de produção estiverem documentados.

## 5. Critérios do slice 2: casca, grafo, inspetor, investigação, integrações

| ID | Critério | Como se prova | Estado |
|---|---|---|---|
| S2-1 | Navegação hierárquica sem rota inventada; itens sem rota ficam desabilitados com o motivo | Teste de integridade (todo `href` existe) | Atendido |
| S2-2 | Real, demonstração e fixture são inconfundíveis: selo no topo, faixa nas telas fictícias, etiqueta por item, paleta rotulada, marca sem afirmação | Testes de interface e revisão visual | Atendido |
| S2-3 | Nós e relações vêm só de dados persistidos; nenhum vizinho fantasma; arestas com direção e base (coluna da fonte ou vínculo gravado) | Testes unitários e de produto (SQL real) e conformância SQL × memória | Atendido |
| S2-4 | Isolamento: nó de outro tenant não existe; entradas hostis recusadas; somente leitura (contagens inalteradas) | Testes de produto com dois tenants | Atendido |
| S2-5 | Grande vizinhança: recorte com aviso, "mostrar mais" até o teto, lista como alternativa acessível | Testes de interface e de layout (sem sobreposição até 96 nós) | Atendido |
| S2-6 | Inspetor separa fato, derivado e sugestão; mostra origem, atualidade e verificação; origem de teste nunca é dita verificada | Testes de interface | Atendido |
| S2-7 | Investigação: ferramentas reais e somente leitura, validadas no servidor, tenant da sessão, sem links externos, sem simular agente | Testes da ação e da interface | Atendido |
| S2-8 | Integrações: só o verificado agora é operacional; fontes bloqueadas nunca; nenhum valor de configuração aparece | Testes de unidade e de interface | Atendido |
| S2-9 | Cidades: indicadores do workspace, ligação ao grafo, filtros legíveis | Testes e revisão visual | Atendido |
| S2-10 | 25 mutações relevantes detectadas | Mutação em cópia isolada | Atendido |
| S2-11 | Telas reais com sessão autenticada (desktop e celular), teclado e contraste | Não executado: exige sessão real | **Pendente** |

## 6. Critérios do Slice A: motor de oportunidades (ADR-023)

| ID | Critério | Como se prova | Estado |
|---|---|---|---|
| A-1 | O usuário inicia uma pesquisa pela interface e vê o resultado por fonte (requisições, registros, erros) | Teste da ação e da interface; execução ao vivo (CLI equivalente) | Atendido em código e testes; **visual com sessão real pendente** |
| A-2 | Fontes reais com proveniência (URL exata, data de coleta e publicação, base, limitações); nenhuma simulada | Testes com respostas reais capturadas; consulta ao vivo ao BCB, IBGE e Agência Brasil | Atendido |
| A-3 | Evidência e oportunidades gravadas sem duplicar ao repetir | Teste de produto e 2ª execução ao vivo (0 novos) | Atendido |
| A-4 | Isolamento entre tenants (leitura, escrita, transição, reavaliação) | Teste de produto com dois tenants; mutação (RLS não forçada, UPDATE no histórico) detectada | Atendido |
| A-5 | Hipótese, evidência, o que falta medir e verdade de cada dimensão visíveis; desconhecido nunca vira zero | Testes do score e da interface | Atendido |
| A-6 | Score V2 configurável por tenant e vertical, versionado, com comparação entre versões e histórico | Testes do motor e de produto; tela `/opportunities/score` | Atendido |
| A-7 | Ciclo de vida: transições validadas no código E no banco (19x19 conferidos), eventos imutáveis | Teste de produto | Atendido |
| A-8 | Concorrência e recuperação (uma pesquisa por tenant; abandonada recuperada) | Teste de produto | Atendido |
| A-9 | Falha de fonte não derruba nem inventa dado | Teste de produto e dos adaptadores | Atendido |
| A-10 | Mutações relevantes detectadas | 57 mutações em cópia controlada: unidade 22/23 (1 equivalente), banco 12/15 (3 sobreviventes explicados no relatório), web 19/19 | Atendido, com ressalvas registradas |
| A-11 | Demanda, SERP e concorrência permanecem `unknown`; prioridade nunca `overall` sem os 3 objetivos | Testes | Atendido (limitação real, não defeito) |
| A-12 | Telas reais com sessão autenticada, no Neon | Não executado: migration 0008 não aplicada e sem sessão | **Pendente** |

## 7. Critérios dos Slices C/D/B/E: blueprint, gates, roadmap e fontes bloqueadas (ADR-024)

| ID | Critério | Como se prova | Estado |
|---|---|---|---|
| C-1 | O blueprint nasce só de dados gravados; mesmo insumo, mesmo conteúdo e hash; nenhum horário no conteúdo | Testes unitários | Atendido |
| C-2 | Template só do registro real; experiência sem template é `missing` com o motivo; nenhuma seção inventada | Testes unitários e de produto; execução ao vivo | Atendido |
| C-3 | Seis gates independentes, sem nota composta; verificação sem fonte é `not_evaluated`; nunca passa por padrão | Testes unitários (7 cenários de reprovação, independência) | Atendido |
| C-4 | Oportunidade só avança com blueprint pronto; vinda de "Elegível", a dispensa da SERP fica registrada no histórico | Teste de produto | Atendido |
| C-5 | Idempotência, isolamento entre tenants, versões imutáveis, banco recusa pronto sem template | Testes de produto; mutação (RLS, UPDATE, CHECK) | Atendido |
| C-6 | Roadmap por prontidão, soma de bloqueios, usa a última versão do blueprint, exclui encerradas | Testes de produto e unitários; execução ao vivo | Atendido |
| C-7 | Ordem do histórico fiel (sequência) | Teste de produto | Atendido |
| C-8 | Transições manuais só para o que não afirma trabalho feito | Testes unitários, da ação e da interface | Atendido |
| C-9 | Fontes bloqueadas: contrato, dependência e dimensões que destravariam; nada simulado | Teste de consistência com o score; telas de tendências e integrações | Atendido |
| C-10 | 28 mutações dos Slices C/D detectadas | Mutação em cópia controlada | Atendido |
| C-11 | Verificação com sessão real e no Neon | Não executado (sem sessão; 0008/0009 não aplicadas) | **Pendente** |
| B/E | SERP, concorrentes, grafo competitivo, monitoramento de IA, desempenho e aprendizado | Dependem de provedor, publicação e Search Console | **Bloqueado** (contrato e estado; sem implementação) |

## 8. Critérios da fase de interface e decisões (ADR-025)

| ID | Critério | Como se prova | Estado |
|---|---|---|---|
| U-1 | Score parcial exploratório: cobertura, desconhecidas e limitações visíveis; não substitui os gates; coberturas diferentes não são tratadas como equivalentes | Testes de interface | Atendido |
| U-2 | `eligible → blueprinted` só por exceção escrita (motivo, autor, horário), SERP `not_evaluated`, pendência visível, não autoriza publicar, revisável | Testes de produto, da ação e da interface | Atendido |
| U-3 | Cada tela responde: o que sei, de onde, o que falta, o que bloqueia, próximo passo | Teste do resumo operacional (puro) e de interface | Atendido |
| U-4 | Blueprint completo, seis gates detalhados com dependência exata, prévia real e decisão de publicação desabilitada | Testes de interface; navegação na prévia | Atendido |
| U-5 | Vocabulário único `live/demo/derived/estimated/not_evaluated/blocked/unavailable` | Testes de interface | Atendido |
| U-6 | Estado verificável das capacidades; nenhuma fonte inexistente declarada implementada | Teste unitário e de interface | Atendido |
| U-7 | Celular sem overflow horizontal; formulários rotulados | Verificação no navegador (6 telas) | Atendido |
| U-8 | Telas reais com sessão autenticada e no Neon | Não executado | **Pendente** |

## 9. Critérios do editor visual de experiência (ADR-026)

| ID | Critério | Como se prova | Estado |
|---|---|---|---|
| E-1 | Domínio ↔ grafo: um nó por nó do domínio, uma aresta por conexão; o grafo não é fonte de fatos | Testes do adaptador | Atendido |
| E-2 | Criar, conectar, editar e remover só o que o contrato permite; conexão incompatível, duplicada, a si mesmo e ciclo recusados | Testes do modelo (24) | Atendido |
| E-3 | Validação de topologia, configuração e dependências; publicação nunca publicável | Testes do validador | Atendido |
| E-4 | Desfazer/refazer, seleção, estados de salvamento, invalidação de resultados | Testes do estado (8) | Atendido |
| E-5 | Serialização e recuperação sem perda; leitura defensiva de entrada | Testes e teste de produto | Atendido |
| E-6 | Persistência em versões imutáveis, concorrência otimista, isolamento por tenant, idempotência | Teste de produto em PostgreSQL real | Atendido (banco descartável) |
| E-7 | Gates reavaliados sobre o rascunho; invalidados por edição até validar | Testes do domínio e no navegador | Atendido |
| E-8 | Prévia sincronizada (seções, ordem, título, links, dados estruturados com proveniência), `noindex`, sem conteúdo inventado | Teste de produto e navegador | Atendido |
| E-9 | ELK só por ação explícita; não sobrescreve posições | Testes e navegador | Atendido |
| E-10 | Alternativa em lista (teclado e leitor de tela) | Teste de interface e navegador | Atendido |
| E-11 | Fluxo completo no navegador (editar, conectar, validar, salvar, recarregar, prévia) | Bancada `scripts/dev-editor.sh` | Atendido sobre banco descartável |
| E-12 | Salvamento no Neon e com sessão autenticada | Não executado (0010 não aplicada; sem sessão) | **Pendente** |

