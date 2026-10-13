# Critérios de aceite do MVP — SEO programático

Fonte: definidos pelo dono do produto em 2026-10-12 (chat) e adotados sem alteração em `docs/audits/MVP_BASELINE_2026-10-12.md`, seção 6. Este arquivo é a referência única das etapas; cada etapa só é "aceita" com evidência reproduzível (teste automatizado, comando com saída ou passo manual reproduzível). Tela ou endpoint não são prova. O estado atual de cada etapa está em `docs/audits/2026-10-13-baseline.md`.

**Não negociáveis:** nenhum dado fictício declarado como integração; nada publicado antes de validação e aprovação explícita; IA não inventa fatos (campo ausente bloqueia a seção ou a página); nenhuma prova por "tela existe"; nenhuma alteração destrutiva sem autorização; sem expansão de escopo (GEO avançado, agentes autônomos, vários templates) antes de a primeira jornada funcionar.

## Etapas, métricas e teste final

1. **Infraestrutura e Neon:** projeto acessível; schema só por migrations versionadas; reaplicação sem inconsistência; conexão fora do repositório; isolamento testado em leitura e escrita; tratamento de falha de conexão e de migration.
2. **Ingestão e Search Console:** CSV de cidades com mapeamento; validação de obrigatórios, tipos, duplicatas; origem, horário e erro por registro; OAuth da propriedade autorizada; consulta real por página e período; limites, expiração e ausência de dados; distinguir real, teste e manual.
3. **Template de cidade:** executável, com versão, campos documentados, sem preenchimento fictício, duas cidades com conteúdo factual diferente, regras explícitas para título, meta, headings, URL e links; atualização sem duplicar URL.
4. **Geração em lote e gates:** ao menos 10 registros válidos; execução registrada; repetição sem duplicar; bloqueio só dos registros inválidos; detecção de ausência de campo, URL duplicada, metadado inválido, link quebrado; reprocessamento sem perder histórico.
5. **Publicação controlada:** preview; aprovação explícita; status HTTP e URLs estáveis; canonical, links e regras de indexação; sitemap só com URLs elegíveis; atualização sem nova URL; recuperação ou reversão testada; ambiente de teste sem indexação acidental.
6. **Medição:** impressões, cliques, CTR e posição por propriedade, página e período; ausência de dado diferente de zero; última sincronização e falhas; páginas de teste separadas das de produção; indexação só com evidência.
7. **Segurança e operação:** testes de autorização entre organizações; nenhum segredo em log ou commit; trilha de auditoria de publicação; jobs recuperáveis; testes ponta a ponta; build e verificações passando; documentação reproduzível.

**Métricas:** 100% dos registros importados classificados (sem descarte silencioso); ≥ 10 registros em lote; 100% das páginas publicadas passam nos gates críticos; zero URLs duplicadas pelo pipeline; zero falhas de isolamento nos testes definidos; 100% das execuções com estado e histórico; métricas conciliadas com a fonte para a mesma propriedade, período e dimensões. **Sem meta de impressões, cliques, posição ou indexação.**

**Teste final (10 itens):** importar ≥ 10 cidades; consultar desempenho no Search Console; gerar páginas distintas; introduzir um registro inválido e comprovar que não publica; aprovar explicitamente; acessar URLs e verificar HTML, canonical, links e sitemap; alterar um dado e atualizar sem duplicar; consultar métricas reais com a última sincronização; tentar acessar outro tenant e comprovar a negação; simular falha e reprocessar.
