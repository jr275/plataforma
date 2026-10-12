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
