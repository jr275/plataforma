# Andamento do motor de páginas (gerado de `packages/api/src/engine/progress.ts`: não edite à mão)

Quatro situações DISTINTAS por item. "Verificado" exige evidência; "bloqueado externamente" exige o bloqueio concreto.

| Inc. | Item | Implementado | Verificado | Evidência | Bloqueado externamente | Pendente |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Entidade, fato bi-temporal, política versionada e catálogo de atributos | sim | sim | test:schema + catalog.product.test.ts; piloto local: 645 municípios, UF/região/população VALID | Bairros, POIs e anúncios: sem fonte real (R12) | — |
| 2 | Geração e persistência de tópicos (identidade determinística, deduplicação por tenant) | sim | sim | topics.product.test.ts (645 tópicos de SP, idempotência, isolamento) e generate.test.ts | Tópicos de bairro/tipologia: sem entidades nem atributos com dados | Agente 2 (propostas): o validador existe; a chamada real depende de ANTHROPIC_API_KEY |
