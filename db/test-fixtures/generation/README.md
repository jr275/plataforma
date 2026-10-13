# Fixture de geração: municípios de São Paulo (IBGE)

`sp-ibge-2026-10-12.csv` é um **extrato real** dos 645 municípios de SP, obtido em 2026-10-12 com `scripts/fetch-ibge-cities.mjs` (API de localidades e estimativa de população 2026 do SIDRA, agregado 6579, variável 9324) e filtrado por UF. Não há linha inventada. O teste `generation.product.test.ts` o importa como execução de origem `real` num PostgreSQL descartável e gera as 20 páginas do piloto (as 20 maiores populações).
