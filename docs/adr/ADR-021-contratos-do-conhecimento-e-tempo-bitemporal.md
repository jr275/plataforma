# ADR-021: Contratos do conhecimento, estados epistemológicos e repositório bi-temporal de referência (Fatia 1)

**Status:** ACCEPTED para a Fatia 1 (2026-10-13), por ser puro código sem banco, reversível e sem dependência nova, dentro da diretiva do dono ("implemente a primeira unidade vertical ... sem interromper para decisões técnicas reversíveis"). A persistência (Fatia 2) terá ADR próprio e precisa de aprovação antes de migrations.

## Contexto
`docs/audits/KG_DIAGNOSTICO_2026-10-13.md`: o repositório não tem modelo de conhecimento, estados epistemológicos, bi-temporalidade, observação imutável nem resolução de entidades; tem tenant com RLS, importação rastreável e `Fact` simples das páginas de cidade. O esquema legado (`db/legacy`) tem só tempo de validade e quatro classes de afirmação, sem Open-World Assumption.

## Decisão
1. **Código puro em `packages/api/src/knowledge/`**, sem banco, rede, relógio nem dependência nova. O relógio é sempre injetado (`at`). Nada de termo imobiliário no núcleo (regra 10): os tipos de entidade e de relação são **registrados** por um catálogo de domínio; o catálogo imobiliário (Property, Listing, Agent, BrokerageOffice, POI, Transaction, com Property ≠ Listing) entra no `packs/real-estate` em fatia própria.
2. **Intervalo temporal** semiaberto `[início, fim)`; cada limite é `instant`, `unbounded` ou `unknown`. Consultas de pertinência e sobreposição são **de três valores** (`true`, `false`, `'unknown'`): limite desconhecido nunca vira "verdadeiro" nem "falso" por padrão.
3. **Estados epistemológicos:** `OBSERVED_TRUE`, `OBSERVED_FALSE`, `INFERRED_PROBABLE`, `CONFLICTING`, `UNKNOWN_STALE`, `ABSENT`. `ABSENT` é a ausência de fato, não um valor armazenado. **Nenhuma transição leva de um estado com fato para `ABSENT`** (Open-World: falta de evidência não apaga). Transições exigem um motivo coerente (`new_observation`, `inference`, `conflicting_evidence`, `resolution`, `expiry`, `revalidation`) e evidência, exceto a expiração. Inferência nunca é tratada como observação direta. Políticas de consumo (assertiva, cautelosa, histórica) dizem quais estados cada uso pode apresentar.
4. **Proveniência:** observação (fonte, referência http/https, instante de observação, instante de ingestão, hash sha256, versão do parser, data da fonte opcional), evidência (suporta ou contradiz; método; transformações versionadas; derivação exige fatos de origem) e **confiança em cinco dimensões separadas** (qualidade da fonte, evidência direta, consistência, atualidade, incerteza de resolução), cada uma `high|medium|low|unknown`. **Não existe função que agregue as dimensões em nota única.**
5. **Fato versionado e bi-temporal:** cada versão tem `validTime` (quando vale na realidade) e `recordedAt`/`supersededAt` (tempo de transação, atribuído só pelo repositório, monotônico). Gravar é **append-only**: corrigir fecha a versão antiga no tempo de transação e reinsere as partes não afetadas; nada é apagado. Consultas por `(validAt, knownAt)` reconstroem o que o sistema sabia em qualquer instante. Observação concorrente de outra fonte com valor diferente marca as versões envolvidas como `CONFLICTING`, sem sobrescrever. Expiração (`staleAfter`) gera versão `UNKNOWN_STALE` sem perder a anterior. Encerramento de vigência (tombstone) fecha o tempo de validade sem declarar inexistência.
6. **Limites declarados desta fatia:** o repositório de referência é **em memória** e **rejeita** intervalos de validade com limite `unknown` (o contrato os representa; a decisão de como tratá-los no armazenamento fica para a Fatia 2). O conflito é **segmentado no tempo**: só o trecho em que os dois valores se sobrepõem vira `CONFLICTING`. Não há resolução de entidades, pipeline, banco nem agentes aqui.

## Alternativas rejeitadas
- **`created_at`/`updated_at` como "bi-temporal":** não reconstrói o conhecimento passado nem registra correções retroativas.
- **Banco de grafo, vetor ou biblioteca de temporalidade agora:** o requisito é semântico e testável em TypeScript puro; o PostgreSQL atual atende a persistência (Fatia 2).
- **Nota única de confiança:** esconde falhas por dimensão; proibida pela diretiva e pela regra 5.

## Consequências
- Contratos e semântica ficam executáveis e testados antes de qualquer migration; a Fatia 2 espelha em SQL (exclusão de sobreposição em tempo de validade e de transação) o que aqui está provado.
- O `Fact` das páginas de cidade (ADR-019) passa a ser caso particular deste modelo numa fatia posterior, sem quebrar o contrato atual.

## Adendo (2026-10-13): correções após revisão
- **Imutabilidade profunda:** datas, intervalos e valores são copiados na entrada e na saída; alterar o que o chamador passou ou recebeu não altera o repositório.
- **Conflito segmentado** por interseção e subtração de intervalos (um conflito iniciado em março não contamina janeiro e fevereiro); repetir a mesma observação concorrente é idempotente.
- **Prazo (`staleAfter`):** um conflito não resolvido até o prazo vira `UNKNOWN_STALE` (as duas versões permanecem no histórico); repetir a mesma afirmação com a mesma evidência e prazo diferente é um refresh que gera versão nova e preserva o prazo anterior no histórico.
- **Tenant:** o repositório é vinculado a um tenant (`new BiTemporalStore({ tenantId })`); escrita com chave de outro tenant é recusada e leitura lança `TenantMismatchError`. No armazenamento persistido o isolamento continuará sendo imposto também por RLS (Fatia 2).
- **API pública:** exposta só como namespace `knowledge` na raiz do pacote (`api.knowledge.BiTemporalStore`), sem nomes genéricos soltos.
