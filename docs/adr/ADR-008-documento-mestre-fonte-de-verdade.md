# ADR-008: Documento mestre como fonte de verdade
Status: ACCEPTED (2026-10-10)

Contexto: decisões espalhadas por Blueprint, doc.txt, gpt.txt e conversas, com contradições (Page Quality Score 90/75 contra gates sem nota; três contagens de módulos).

Decisão: "Menlo OS — Visão de construção" (https://claude.ai/artifact/X4nLZ1c6pRUQDDFpRv9rLT) é a fonte de verdade. Onde outro texto divergir, vale o documento mestre. `docs/blueprint.md` é referência de apoio. Mudança de decisão: primeiro no documento mestre, depois nos arquivos de apoio.

Consequências: lugar único para ler e discutir; o documento vive fora do repositório, mitigado pelo `CLAUDE.md` que cita o endereço e por copiar toda ADR aceita para `docs/adr/`.
