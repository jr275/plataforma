# MVP — Etapa 2 (parte IBGE): ingestão de cidades

Data: 2026-10-12. Referência: commits `c3ee5d0`, `32953cb`, `800f615`, `e3b7724` (locais; ainda sem push). Decisão: ADR-017 (ACCEPTED).

## Fatos verificados (com evidência)
| Fato | Evidência |
| --- | --- |
| Migrations 0003 e 0004 aplicadas no Neon dev (`plataforma-dev`, PG 16.15) com o gate de segurança ativo | saída do runner: `gate ok` e `applied` para 0003 e 0004; `ledger head: 4`; `2 aplicada(s), 2 já atualizada(s)` |
| Tenant `remax` criado por operação administrativa (fora das migrations) | `scripts/neon-create-tenant.sh` → `tenant remax = fce17b74-dd74-42cf-bd4e-daec979c06be`; reexecução não duplica (`ON CONFLICT`) |
| Carga REAL do IBGE no Neon: 5.571 municípios, 100% classificados | saída do CLI: `status succeeded, total 5571, accepted 5571, rejected 0, duplicate 0, warnings 9`; runId `472da87f-8c52-4505-8f38-550320983ce7`; sha256 do arquivo `2b4e4fc9…3e38f` |
| Os 9 avisos são o dígito verificador do código IBGE (municípios reais) | mesma contagem na carga em PostgreSQL descartável e no perfil dos dados de 2026-10-12 |
| Isolamento entre tenants nas três tabelas novas | `pnpm test:schema` 55/55 (PostgreSQL descartável) e `scripts/test-neon.sh` 22/22 (branch temporário do Neon) |
| Falha do banco no meio da gravação desfaz tudo e marca a execução `failed` | teste em `run.product.test.ts` |
| Reimportar não duplica | teste com o fixture e com a carga real (descartável); `UNIQUE (tenant_id, ibge_code)` + upsert |

## Simulado ou não provado
- A carga real foi executada pelo CLI com a **identidade de desenvolvimento** (`dev-user`, em `created_by`); não passou pelo login (Supabase). A ligação login → servidor do Next → banco ainda não existe.
- A tela **Fluxo de dados** ainda mostra dados de demonstração. Nada nela é prova desta etapa.
- Os dados de população são a **estimativa 2026 do IBGE** (agregado 6579, variável 9324); não foram conferidos linha a linha contra outra fonte.
- `test-neon.sh` e a carga real no Neon não rodam no CI (precisam de credencial).

## Lacunas
1. Tela Fluxo de dados ligada às funções `listImportRuns`/`listImportRecords`/`listCities` (exige acesso ao banco no servidor do Next, identidade do login e `menlo_app` nas variáveis do Vercel).
2. Search Console (ADR-016): propriedade, permissão, autorização da RE/MAX e regex de marca ainda dependem do dono; carregador a reescrever.
3. `menlo_app` pode executar `pg_advisory_lock` no Neon (risco aceito só para desenvolvimento).
4. O papel dono do Neon tem `BYPASSRLS` (só preparação).

## Critérios de aceite desta parte (atendidos ou não)
- 100% das linhas classificadas: **atendido** (5571 = 5571 + 0 + 0).
- Zero URLs/códigos duplicados na carga: **atendido** (0 duplicados; único por tenant no banco).
- Zero falhas de isolamento: **atendido** nos testes citados.
- Documentação reproduzível: **atendido** (`docs/runbooks/neon-dev.md`, scripts versionados).
- Dados reais com origem registrada: **atendido** (`origin real`, `source IBGE`, sha256, horário, erro por registro).
