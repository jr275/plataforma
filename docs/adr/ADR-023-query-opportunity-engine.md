# ADR-023: Query Opportunity Engine (Slice A): modelo, fontes reais, score V2, ciclo de vida e verticais

**Status:** ACCEPTED (2026-10-13) por mandato expresso do dono no chat ("Build the Real SEO + GEO Opportunity Engine"). **Dois pontos pedem confirmação do dono** (marcados com ⚠): a revogação parcial do ADR-014 (nota composta) e a aplicação da migration `0008` no Neon, que **não** foi aplicada.

## Contexto

- O produto lê dado real só em cidades, geração de páginas e fluxo de dados. A tela de oportunidades é demonstração (`apps/web/src/data/demo`); a tabela legada `opportunity` (ADR-014, migration 0002) guarda fatores qualitativos digitados e não tem fonte, evidência, score versionado nem ciclo de vida.
- O mandato pede o motor central: uma **oportunidade é uma hipótese de crescimento baseada em evidências**, não uma palavra-chave isolada. Exige fontes reais com proveniência, agrupamento de queries sem misturar intenções, score explicável e configurável, ciclo de vida auditável e isolamento por tenant.
- Regras que continuam valendo: fatos nunca vêm de LLM (1), RLS e teste de isolamento em toda tabela (2), idempotência (3), nenhuma tela lê o banco direto (4), núcleo genérico: termos de imóvel só em `packs/real-estate` (10).
- Verificado em 2026-10-13: Google Trends, provedores de SERP, Search Console, GA4 e mecanismos de IA **não têm credencial nem autorização** neste projeto. Estão acessíveis, sem credencial, APIs públicas oficiais: Banco Central (SGS), API de notícias do IBGE e o feed RSS público da Agência Brasil (`robots.txt` com `Crawl-delay: 10`).

## Decisão

### 1. Unidade de trabalho e persistência (migration `0008_opportunity_engine`)
Sete tabelas do tenant (RLS forçada, política canônica, chaves compostas), todas novas; a tabela legada `opportunity` **não é alterada nem apagada**:
`research_run` (execução de pesquisa, uma `running` por tenant), `evidence` (registro com proveniência; único por tenant, adaptador, `source_ref` e hash do conteúdo), `growth_opportunity` (uma por cluster; a `cluster_key` mora nela), `opportunity_evidence` (vínculo com a razão da relevância), `score_config` (versões imutáveis por tenant e vertical), `opportunity_score` (histórico imutável) e `opportunity_event` (histórico imutável do ciclo de vida e da auditoria). Sem `DELETE` para a aplicação.

### 2. Política de verdade
Todo valor relevante carrega `basis`: `observed`, `provider_metric`, `derived`, `inferred`, `estimated` ou `unknown`. **Ausência de dado é `unknown`, nunca zero nem valor plausível.** Demanda de busca não tem fonte hoje: toda oportunidade nasce com `demand = unknown`. LLM não participa desta fatia.

### 3. Fontes
Contrato `SourceAdapter` (consulta com limite de tempo e de tamanho, `User-Agent` identificado, `robots.txt` respeitado onde há extração, atraso por host, resultado com proveniência e limitações). Adaptadores reais desta fatia: **BCB SGS** (séries 432 Meta Selic, 13522 IPCA 12 meses, 189 IGP-M), **notícias do IBGE** e **RSS da Agência Brasil**. Dados do tenant (cidades do IBGE já importadas) alimentam as entidades. Trends, SERP, Search Console, GA4 e IA: contrato e estado "bloqueado" na tela de integrações, **sem adaptador simulado**. Uma fonte só é "operacional" depois de uma consulta real bem-sucedida registrada em `research_run`.

### 4. Hipóteses de query, não descobertas de demanda
A vertical define **padrões de query** (modelo, intenção, estágio, JTBD, experiência recomendada, evidência exigida). O motor os combina com as entidades reais do tenant e gera **hipóteses** (`basis = inferred`, explicadas). Nada disso é volume, tendência nem ranking observado.

### 5. Agrupamento
Chave do cluster = vertical + padrão + intenção + entidade. Variações viram `variants` do mesmo cluster; **intenções diferentes nunca se fundem**, mesmo com texto parecido. Normalização: minúsculas, sem acento, sem pontuação e sem palavras vazias.

### 6. Score V2 ⚠
- 15 dimensões, três objetivos distintos (**valor comercial**, **viabilidade de execução**, **oportunidade de descoberta**), pesos e regras por tenant e vertical em `score_config` versionado, normalização documentada, penalidades por risco e incerteza, análise de sensibilidade e histórico por cálculo.
- Dimensão sem dado é **ausente** e fica fora da conta; cada objetivo exige cobertura mínima de pesos para existir. Sem a cobertura, o objetivo é `unknown`.
- `prioridade`: `overall` só quando os três objetivos existem; `partial` (média geométrica dos objetivos que existem, rotulada "sem medição de X"); `none`. **Isto revoga, só para priorização de oportunidades, a linha "nota composta de prioridade: proibida" do ADR-014**, por decisão do dono. Limites: o agregado é configurável, versionado e sempre acompanhado dos componentes; **nunca** é um gate de publicação (os gates continuam independentes, sem nota composta, regra 5); não promete ranking nem citação.

### 7. Ciclo de vida
Estados do mandato mais `Rejected`. Transições validadas no código **e** por gatilho no banco (tabela de transições única, conferida por teste). Cada transição grava um evento imutável. Bloqueios e dependências externas ficam em `blockers`, não em estados.

### 8. Verticais
Contrato genérico no núcleo (`packages/api/src/engine/vertical.ts`): entidades, intenções, estágios, padrões de query, regras de sinal, pesos padrão e elegibilidade. A vertical imobiliária vive em `packs/real-estate` (pacote `@plataforma/pack-real-estate`), registrada na raiz de composição do aplicativo. O núcleo não cita imóvel.

### 9. Orquestração
A pesquisa roda no servidor, por ação autenticada, em transações curtas por tenant (mesmo padrão do ADR-020: abre a execução, coleta, grava, fecha; recuperação de abandonadas). Idempotente: repetir não duplica evidências, clusters nem oportunidades.

> **Refinado pelo ADR-025 (2026-10-14):** a prioridade composta fica confirmada como ordenação exploratória, com cobertura explícita e sem substituir os gates.

## Alternativas rejeitadas
- Alterar a tabela `opportunity` existente: mistura dois modelos e mexe numa tabela já aplicada.
- Fórmula única e fixa de score: contraria o mandato e esconde a vertical.
- Preencher demanda com estimativas de LLM: viola a regra 1.
- Adaptadores simulados para Trends/SERP: representariam fonte inexistente.

## Consequências
- A tela `/opportunities` passa a ler o novo modelo; sem `0008` aplicada, ela mostra o estado "tabelas ausentes". **⚠ Aplicar `0008` no Neon exige autorização, branch de restauração e a verificação do runbook `neon-dev.md`**; esta unidade só a aplicou em bancos descartáveis.
- Sem Search Console, a maioria das dimensões de descoberta fica `unknown`: o motor mostra isso em vez de esconder.
- Fatias B a E (SERP, concorrentes, blueprint, gates de experiência, roadmap, grafo competitivo, GEO) usam este modelo e migrations próprias.
