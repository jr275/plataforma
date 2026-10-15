# ADR-023: Ahrefs como provedor externo complementar

**Status:** PROPOSED (2026-10-14). Implementado só o adapter com testes sem rede (`packages/api/src/intel/ahrefs.ts`). **Não validado contra a API real:** a chamada gratuita de uso e limites devolveu HTTP 401 e o dono informou que a conta está sem saldo de API. Nada foi persistido, nenhuma migration foi criada e nenhuma tela foi alterada.

## Contexto

- O motor de oportunidades já tem o padrão de provedor em `packages/api/src/intel/`: `ProviderResult` com quatro estados, proveniência, cache com chave determinística e orçamento por execução (DataForSEO e Search Console).
- A Ahrefs tem fatores que o score v1 já nomeia (competição por dificuldade, autoridade por backlinks, demanda por volume), mas hoje vindos de outras fontes.
- A API cobra em unidades: cada requisição paga custa `max(50, custo_por_linha × linhas)` (docs oficiais, "Limits & consumption"); o limite padrão é 60 requisições por minuto (HTTP 429).

## Decisão

1. A Ahrefs entra como **fonte complementar** atrás do mesmo contrato `ProviderResult`. Nunca substitui DataForSEO ou Search Console e nunca sobrescreve um fator já medido (`fillMissingFactors`).
2. **Desligada por padrão e desativável.** Sem `AHREFS_API_KEY` (ou com `AHREFS_ENABLED=false`) o provedor responde `provider_not_configured`; o resto da plataforma não é afetado.
3. **Custo controlado.** Consulta paga só sai com `AHREFS_UNIT_BUDGET` definido e com a estimativa cabendo no orçamento da execução. Campos pedidos vêm de uma lista fechada, porque o custo depende deles. O custo gravado é **estimado**, até a API reportar o consumo de forma verificada.
4. **Retries mínimos.** Só HTTP 429 é repetido (até 2 vezes, respeitando `Retry-After`). Timeout e 5xx não são repetidos, para não duplicar consumo.
5. **Primeira versão, uma capacidade:** `keywords-explorer/overview` (volume, dificuldade, CPC) e a consulta gratuita de uso e limites. SERP, concorrentes, backlinks e Brand Radar **não** foram implementados: o custo e o acesso do plano não foram verificados.
6. **Multi-tenant.** Só dados públicos de mercado são consultados, com a credencial global da plataforma; nenhum dado de tenant sai na requisição. Por isso o cache é compartilhado entre tenants (documentado), e o tenant solicitante fica na proveniência. **BYOK não está implementado**; se vier, a chave de cache terá de incluir o tenant, e consultar o domínio do cliente (`target`) só será permitido depois disso.
7. **Sem fórmula nova.** A normalização usada é a escala documentada pela Ahrefs (dificuldade ÷ 100); demanda não é derivada até existir uma escala de referência de volume definida e validada.

## Alternativas rejeitadas

- **Substituir o DataForSEO:** quebra a fonte existente e depende de um plano que ainda não foi comprovado.
- **Persistir as observações agora:** exigiria migration, fora do escopo desta etapa. O cache atual é injetado (memória nos testes).
- **Retry em 5xx e timeout:** pode consumir unidades em duplicidade.

## Consequências

- Quando houver saldo, falta validar com **uma** chamada real e autorizada: o formato do header de autenticação (`Bearer`, padrão da v3, não confirmado na documentação lida), os nomes dos campos, e se a API reporta o consumo de unidades.
- Persistência das observações (tabela e RLS) e a interface ficam para fatias futuras, cada uma com a sua decisão.
