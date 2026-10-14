# Fixtures dos provedores (ADR-027)

Nenhuma contém credencial.

| Arquivo | Origem |
| --- | --- |
| `sidra-4714-3550308.json` | **Real**, capturada em 2026-10-14 de `apisidra.ibge.gov.br/values/t/4714/n6/3550308/v/93,614/p/last` (São Paulo, Censo 2022). |
| `gdelt-429.txt` | **Real**: resposta do GDELT (HTTP 429) quando se excede 1 requisição a cada 5 s. |
| `gdelt-empty.json` | **Real**: resposta `{}` do GDELT para uma consulta sem resultados. |
| `overpass-504.html` | **Real** (truncada): resposta HTTP 504 do Overpass quando o servidor está sobrecarregado. |
| `gdelt-artlist.json` | **Construída a partir do formato documentado** do GDELT (`mode=artlist`); NÃO foi capturada (a API limitou as requisições). Domínios e títulos são fictícios. |
| `overpass-count.json` | **Construída a partir do formato documentado** do Overpass (`out count`); NÃO foi capturada (o servidor retornou 504). O número é fictício. |

Os dois arquivos construídos só provam o *parser*; não provam que a fonte respondeu. O estado verificado de cada fonte está no relatório da unidade.
