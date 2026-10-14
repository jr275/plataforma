# Fixtures de adaptadores: respostas REAIS capturadas

Capturadas em 2026-10-13 (relógio local) com `curl`, `User-Agent: plataforma-research/0.1`, direto das fontes públicas abaixo e **apenas aparadas** (menos linhas), sem alterar valores:

| Arquivo | Origem |
| --- | --- |
| `bcb-432.json`, `bcb-13522.json`, `bcb-189.json` | API de dados abertos do Banco Central (SGS): meta Selic, IPCA 12 meses, IGP-M mensal. A série 432 traz datas FUTURAS com a meta vigente (comportamento real da série). |
| `ibge-news.json` | `servicodados.ibge.gov.br/api/v3/noticias` (busca "habitação") |
| `agenciabrasil-economia.xml`, `agenciabrasil-robots.txt` | feed RSS e `robots.txt` da Agência Brasil |

Servem só como entrada dos testes dos adaptadores (formato real). Não são dados do tenant nem entram no banco. A prova de que as fontes respondem hoje é a verificação ao vivo documentada nos relatórios (`scripts/live-discovery.sh`), que não roda no CI.
