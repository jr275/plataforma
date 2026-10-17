## O que mudou

## Como verificar

## O que ficou pendente

## Checklist (regras inegociáveis)
- [ ] Nenhum número de fato em texto sem `{{fact:id}}` ligado a fato com fonte
- [ ] Tabela nova do data plane tem `tenant_id`, RLS e teste de isolamento entre dois tenants
- [ ] Passo de workflow é idempotente
- [ ] Nenhuma tela lê o banco direto (só `packages/api`)
- [ ] Sem nota composta: cada gate grava seu resultado em `quality_gate_result`
- [ ] ADR escrito antes do código, se houve decisão de arquitetura
- [ ] Sem dados pessoais no grafo público nem em prompts
- [ ] Sem RE/MAX, imóvel ou corretor no núcleo (só em `packs/real-estate`)
- [ ] Tipos, lint e testes verdes; `pnpm eval:gate` se mexeu em gate, juiz, prompt ou template
- [ ] Documento mestre atualizado e aba reexportada, se aplicável

## Checklist de engenharia (`docs/POLITICA_DE_ENGENHARIA.md`)
Marque só o que se aplica; escreva "N/A" com o motivo no que não se aplica (por exemplo, "N/A: só documentação").

**Sempre**
- [ ] Mudança pequena, isolada e reversível; diff completo revisado (inclusive arquivos gerados e não rastreados)
- [ ] Nenhum segredo em logs, diffs ou commits
- [ ] Testes relevantes e CI verificados, com o local e o CI do GitHub distinguidos e a evidência registrada (comando, ambiente, resultado, limitações)

**Se tocou migration ou banco**
- [ ] Ledger, checksums e schema de todos os ambientes relevantes verificados (somente leitura); nenhuma migration potencialmente aplicada editada em silêncio; colisão de número tratada com decisão do dono
- [ ] Sequência testada em banco descartável com o gate ativo; ponto de recuperação verificável e, quando aplicável, ensaio em branch temporária do Neon
- [ ] Nenhuma operação em banco compartilhado ou produção sem autorização explícita para aquela operação e ambiente

**Se tocou tabela do data plane, identidade ou tenant**
- [ ] Teste de isolamento entre dois tenants; tenant vindo de fonte confiável (não `tenantIds[0]`)

**Se afetou a interface**
- [ ] Layout azul/lavanda da `main` preservado (comparado com a `main`)
