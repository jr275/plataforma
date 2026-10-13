# Proposta (NÃO implementada): entidade `property` (imóvel) — pré-requisitos e bloqueio

Status: **bloqueada por falta de fonte real e autorizada**. Nada foi implementado; nenhum dado de imóvel foi criado, simulado ou usado como exemplo. Nenhuma autorização da RE/MAX é afirmada neste documento: ela **não foi apresentada**.

## O que falta, exatamente
1. **Fonte real de dados de imóveis**: arquivo (CSV/JSON), feed ou API da RE/MAX (ou de outra origem que o dono indique), com a **estrutura real** (uma amostra). O que existe hoje no ecossistema (o provedor `mock_mls` do Menlo Studio) se declara demonstração e não serve.
2. **Autorização documentada** de quem detém os dados (RE/MAX ou franqueado) para armazená-los e usá-los para gerar páginas, incluindo termos de uso, direitos sobre as fotos e frequência de atualização. Quem concede e em que termos é decisão do dono; o projeto não presume.
3. **Política de dados pessoais** (regra 7 do projeto, LGPD): se a fonte trouxer proprietário ou contato do corretor, dizer o que é descartado antes de gravar.

## Campos mínimos que a fonte precisa trazer (nada é inventado; campo ausente fica nulo e bloqueia a seção)
| Campo | Por quê |
| --- | --- |
| identificador da fonte do imóvel (`external_id`) | idempotência e deduplicação (`UNIQUE (tenant_id, external_id)`) |
| tipo (apartamento, casa, …) | contrato do template |
| município e UF (ou código IBGE) | ligar à `city` existente |
| área em m², quartos, banheiros | fatos citáveis |
| preço, moeda e data do preço | fato com validade (regra 1) |
| situação (ativo, vendido, …) | elegibilidade para páginas |
| data de atualização informada pela fonte | atualidade e proveniência |
Opcionais só se a fonte tiver: bairro, endereço (avaliar privacidade), fotos (URLs e direitos).

## Como a entidade deve respeitar o modelo existente
- **`tenant_id` e RLS:** `tenant_id NOT NULL` referenciando `tenant`, RLS ligada e forçada, política canônica `tenant_id = plataforma.current_tenant_id()`, FKs compostas `(tenant_id, …)`, `UNIQUE (tenant_id, id)`, **sem DELETE** para `menlo_app` (baixa = mudança de situação), e o teste de isolamento entre dois tenants no mesmo PR (regra 2).
- **Proveniência e rastreabilidade da importação:** cada imóvel aponta, por FK composta, para o `import_run` que o gravou (origem real/teste/manual, `sha256`, horário), e cada linha do arquivo fica em `import_record` (linha bruta, desfecho, motivos). Para isso o tipo de execução (`import_run.kind`, hoje só `'csv'` de cidades) e o mapeamento precisam ser generalizados por uma migration nova, sem quebrar o importador de cidades.
- **Histórico:** mudanças de preço e de situação não podem destruir valores anteriores. No mínimo, uma tabela imutável de versões por imóvel (como `page_version`); a forma bi-temporal completa é a Fatia 2 do ADR-021.
- **Property ≠ Listing (ADR-021):** o imóvel físico e o anúncio têm ciclos de vida distintos. A primeira fatia deve declarar quem é quem e começar só pelo que a fonte realmente fornece.
- **Páginas de imóvel:** exigem **template novo** (o `city-overview` só consome fatos de cidade) e generalização de `Fact`/`FactKey`, com ADR próprio antes do código (regra 6). Um fato sem fonte e validade não vira texto.
- **Testes obrigatórios:** isolamento de leitura e escrita entre tenants, classificação de 100% das linhas (aceita/rejeitada/duplicada), duplicidade por `external_id`, imutabilidade do histórico, ausência de DELETE, estados da interface (vazio, erro, sem permissão, migrations pendentes).

## Decisão do dono necessária
Qual é a fonte (e quem autoriza o uso). Sem ela, o item "Imóveis" da primeira fatia permanece **BLOCKED**.
