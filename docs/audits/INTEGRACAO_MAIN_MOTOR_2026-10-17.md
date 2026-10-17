# Integração `main` × branch do motor: colisões e plano (2026-10-17)

**Só texto e leitura.** Nenhuma migration foi escrita ou aplicada, nenhum banco foi acessado, nada foi renumerado, e nenhuma branch existente foi alterada. É uma proposta que depende de decisões do dono do produto.

## 1. Fatos verificados (leitura do Git)

- `main` (origin) tem as migrations `0001` a `0008_intel_real_data`. A branch `feat/opportunity-engine` tem `0001` a `0022`, e as migrations `0001` a `0007` são **idênticas** nos dois lados (SHA-256 conferido).
- A `0008_intel_real_data` da `main` veio do commit `78183e5` (v0, 14/10), cujo título diz **"unapplied migration 0008"**. A `0008_opportunity_engine` do motor é **outra migration**, com o mesmo número.
- O merge `9a53d83` (main → motor) registra: a `0008_intel_real_data` **não foi incluída**, porque recria tabelas que o motor já criou nas migrations 0008 a 0011 "com outro desenho", e "precisa ser reconciliada como migration nova".
- **6 tabelas colidem** (mesmo conceito, colunas diferentes): `competitor`, `opportunity_score`, `opportunity_signal`, `page_blueprint`, `serp_result`, `serp_snapshot`. Além disso, a `main` estende `plataforma.opportunity` e cria `opportunity_transition` e `provider_call_log`; o motor cria `growth_opportunity`, `evidence`, `score_config`, `provider_call`, entre outras.
- O desenho do motor é mais completo (por exemplo, `opportunity_score` com `config_id`, `model_version`, `inputs_hash` e `eligible`; `page_blueprint` com `gates`, `blockers` e `ready`; `opportunity_signal` com `expires_at`).
- **Na `main`, nenhum código consulta o desenho da `0008`**: a única referência é um comentário em `packages/api/src/intel/provider-runtime.ts`.
- **ADRs 023 a 027 colidem:** a branch do motor tem ADR-023 a ADR-034 (com outros assuntos); as branches do trabalho de 12 a 17/10 criaram ADR-023 (Ahrefs), 024 (oportunidades reais), 025 (fluxo vivo), 026 (export do Search Console) e 027 (OAuth). O índice `docs/adr/README.md` também conflita entre essas branches.

## 2. O que NÃO foi verificado

- **O estado real de qualquer banco persistente** (ledger do Neon de desenvolvimento ou outro). Se algum já aplicou a `0008_intel_real_data`, o ledger guarda o SHA dela e o runner rejeitaria um histórico diferente. Verificar isso exige acesso de leitura ao banco, que não foi autorizado.
- Se as telas do motor funcionam com o desenho do motor em todos os pontos: não foi executado nada.

## 3. Opções

- **A. O motor vence (recomendada, se nenhum banco aplicou a `0008` da `main`).** A autoridade do esquema é a sequência do motor (`0008` a `0022`); a `0008_intel_real_data` da `main` é retirada. Menor risco: nada depende dela e o autor a marcou como não aplicada.
- **B. A `main` vence:** descarta as migrations `0008` a `0022` do motor. Rejeitada: descartaria muito mais trabalho (grafo de conteúdo, POI, fábrica de páginas).
- **C. Migration nova que reconcilia (a "0023")**: necessária **só se** algum banco persistente já aplicou a `0008` da `main`, porque aí o histórico não pode ser reescrito.

## 4. Ordem proposta (cada passo pede autorização própria)

0. **Decidir A ou C.** Para escolher, ler o ledger dos bancos persistentes (leitura apenas, com autorização).
1. **Definir a base:** a `integration/main-and-engine` (ou a `merge/main-into-engine`) vira a base de integração; a `main` é atualizada por PR, nunca por push direto.
2. **Renumerar os ADRs do trabalho de 12 a 17/10** para depois do ADR-034 do motor (proposta: 023→035, 024→036, 025→037, 026→038, 027→039), atualizando as referências em texto, comentários e testes, e o índice. **Não feito:** depende da decisão do passo 1.
3. **Rebasear os PRs abertos** ([#8 a #13](https://github.com/jr275/plataforma/pulls)) sobre a base integrada; o único conflito conhecido entre eles é o índice de ADRs.
4. **Só então fixar o número das migrations novas** (`search_*` do ADR-016 e a conexão do ADR-027): na linha do motor, o próximo número é `0023`.
5. **Validar** com `test:migrations`, `test:gate`, `test:rls`, `test:security`, `test:bootstrap`, `test:hardening` e `turbo typecheck lint build`, em clusters descartáveis.

## 5. Decisões do dono do produto

- Qual linha é a base: a do motor (recomendado) ou a `main`?
- Algum banco persistente aplicou a `0008_intel_real_data`? Autoriza a leitura do ledger?
- Autoriza a renumeração dos ADRs 023 a 027 do trabalho de 12 a 17/10?
