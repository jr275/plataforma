# ADR-009: Migração 0.3 do esquema
Status: ACCEPTED (2026-10-10)

Contexto: o esquema 0.1 não tinha regras de publicação nem de envelhecimento do conhecimento.

Decisão: a migração 0.3 acrescenta política de uso de fontes, contrato e elegibilidade de superfície, ciclo de vida da localidade, padrões de conhecimento (base de Scale/Refine/Stop e do teste de diferenciação), a ação `retire` e RLS nas tabelas novas. 5 testes passam.

Consequências: as migrações 0.4 (page_type, visões do Search Console) e 0.5 (RLS em views e `tenant`) se apoiam nela. Faltam a tabela `surface_link` e o rastreador pós-publicação para o gate de página órfã.
