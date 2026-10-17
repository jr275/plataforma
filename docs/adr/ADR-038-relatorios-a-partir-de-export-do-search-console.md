# ADR-038: Relatórios a partir de export do Search Console (sem banco)

**Status:** PROPOSED (2026-10-16). Implementado só em código local. **Nenhum banco foi acessado e nenhuma migration foi criada.**

## Contexto

- A credencial do Search Console da Plataforma já autentica no Google, mas a propriedade ainda não foi autorizada pelo dono (a validação devolve "Permissão negada"). Sem conexão, não há dado vivo.
- O dono do produto exportou o desempenho da RE/MAX direto do Search Console (busca web e recursos de IA generativa, últimos 6 meses × 6 meses anteriores) e pediu relatórios dentro da plataforma.
- O ADR-016 (carga em tabelas `search_*` com RLS) segue PROPOSED e exige migrations e aprovação da lista de marca. Nada disso está autorizado.
- Regras que valem aqui: fatos nunca inventados (regra 1); tenant isolado (regra 2); telas só leem por funções tipadas (regra 4); núcleo genérico, sem RE/MAX fora de `packs/real-estate` (regra 10); dado pessoal ou do cliente não vai para o repositório.

## Decisão

1. **O export vira um "snapshot" agregado**, gerado por `scripts/gsc-export-build.mjs` a partir dos zips do Search Console. O parser é puro e genérico (`packages/api/src/intel/gsc-export.ts`): sem E/S, sem marca, sem termo de imóvel.
2. **O snapshot guarda agregados e as 50 maiores consultas, páginas e páginas com impressão em IA** (nomes e números do próprio export, na ordem de cliques ou impressões). Isso é **dado do cliente**: por isso o snapshot fica só em arquivo local fora do Git, e qualquer carga permanente depende do ADR-016.
3. **O snapshot fica num arquivo local fora do Git** (`apps/web/.data/gsc-export.json`, ignorado). Dado de desempenho do cliente não entra no repositório. Em produção o arquivo não existe, e a tela diz "sem dados carregados".
4. **O snapshot é amarrado a um tenant** (`tenantId`). Com sessão, só aparece para quem pertence a esse tenant; fora de produção, sem login, aparece só em desenvolvimento local.
5. **Estado de dado novo: "Importado".** É medição real do Search Console, mas um retrato de uma data, carregado à mão; não é conexão. Não se mistura com "Conectado".
6. **Sem número inventado.** Totais, CTR e posição saem só das tabelas do export (dispositivos, que cobrem 100% do tráfego). A posição é a média ponderada por impressões. As consultas e as páginas exportadas cobrem só parte do tráfego (o Google omite a cauda anônima): a tela mostra essa **cobertura** ao lado de qualquer ranking.
7. **Sem escolhas na tela.** O relatório é uma página só (panorama, páginas e consultas, IA generativa, em seções seguidas), com os mesmos blocos para todos (direção do dono: o produto mostra o resultado, não pede decisões).
8. **Marca × sem marca fica fora desta etapa.** A lista de marca é configuração por tenant com aprovação (ADR-016); sem aprovação, não se calcula.

## Alternativas rejeitadas

- **Versionar os números no repositório:** põe dado do cliente no GitHub e foge do isolamento por tenant.
- **Gravar no banco agora:** exige migrations e a lista de marca aprovada; fica para a aprovação do ADR-016.
- **Usar o Ahrefs como substituto:** é estimativa, não o que o site recebeu do Google.

## Consequências

- Os relatórios funcionam em desenvolvimento local; no preview e na produção aparecem vazios até a carga no banco (ADR-016) ou até a conexão ao vivo (após o dono autorizar `plataforma-gsc@plataforma-511815.iam.gserviceaccount.com` como usuário restrito).
- O snapshot é um retrato: refazer o export atualiza o relatório manualmente.
