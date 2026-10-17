# Documentação

**Fonte de verdade:** o documento "Menlo OS — Visão de construção" (https://claude.ai/artifact/X4nLZ1c6pRUQDDFpRv9rLT). Em caso de divergência entre este repositório e o documento, vale o documento (ADR-008). Comece pela aba "Guia para engenheiros".

- `adr/`: decisões de arquitetura aceitas (007 a 010 aqui; 001 a 006 estão no índice do documento mestre e ainda precisam entrar como arquivos).
- `menlo-os/`: cópia em Markdown, uma por aba, do documento mestre. Cada arquivo traz no topo a data da exportação. Quem altera o documento mestre reexporta a aba.
- `runbooks/`: procedimentos operacionais e de diagnóstico, por exemplo `runbooks/diagnostico-de-indexacao.md` (a matriz Descoberta → Busca → Renderização → Índice → Exibição).
- `POLITICA_DE_ENGENHARIA.md`: política obrigatória de migrations, banco de dados, diagnóstico de falhas e integração de branches.
