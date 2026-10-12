# Search Console (Python, análise e medição)

Fica em `packs/real-estate` porque cita a RE/MAX e sua lista de marca (regra 10: o núcleo não conhece "imóvel" nem "corretor"). Python só para análise e medição (ADR-007). Onde roda: agendador do repositório (ADR-010).

## Extrator: `gsc_semanal.py`
Gera 3 CSVs diários na pasta `saida/`: sem marca por dia e página, total por dia, só marca por dia. Grava um mês por vez em `saida/partes/` e retoma de onde parou.

    pip install -r requirements.txt
    python gsc_semanal.py --site sc-domain:remax.com.br

Login: `client_secret.json` (cliente OAuth do tipo "App para computador") e `token.json` ficam fora do Git (estão no `.gitignore`). A lista de marca (`MARCA_REGEX`) é uma proposta e precisa de aprovação da RE/MAX.

## Carregador: `load_gsc.py`
Idempotente: recarregar o mesmo arquivo atualiza, não duplica. Roda como dono do esquema, nunca como `menlo_app`.

    python load_gsc.py --dsn "$DATABASE_URL" --tenant remax --api-dir ./saida
    python load_gsc.py --dsn "$DATABASE_URL" --tenant remax --export-dir PASTA_DO_EXPORT

## Limites
- A cidade é identificada só por nome e UF (sem código IBGE); grafias diferentes viram entidades diferentes.
- O export da interface tem só as 1.000 maiores páginas e não separa marca; a série semanal sem marca exige os CSVs do extrator.
- A permissão atual da conta na propriedade é "restrita"; se a API devolver 403, a RE/MAX precisa dar permissão completa.
