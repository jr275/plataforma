#!/usr/bin/env node
// Gera o CSV de municípios a partir das APIs públicas do IBGE (dados abertos). Uso:
//   node scripts/fetch-ibge-cities.mjs [saida.csv]      (padrão: ./ibge-municipios.csv, fora do Git)
// Colunas: ibge_code,name,uf,region,population,population_year. A população é a ESTIMATIVA mais recente da agregação 6579
// (variável 9324, SIDRA); se a API não a trouxer para um município, a coluna fica vazia (nunca inventada).
// Imprime o sha256 e as contagens; o arquivo bruto NÃO deve ser commitado.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const LOC = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";
const AGG = "https://servicodados.ibge.gov.br/api/v3/agregados/6579/periodos/-1/variaveis/9324?localidades=N6[all]";

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`IBGE respondeu ${res.status} para ${new URL(url).pathname}`);
  return res.json();
}

const [municipios, agregado] = await Promise.all([getJson(LOC), getJson(AGG)]);

const serie = agregado?.[0]?.resultados?.[0]?.series ?? [];
const populacao = new Map();
let ano = null;
for (const s of serie) {
  const [periodo, valor] = Object.entries(s.serie ?? {})[0] ?? [];
  if (periodo && /^\d+$/.test(valor ?? "")) {
    populacao.set(String(s.localidade.id), valor);
    ano = periodo;
  }
}

const esc = (v) => (/[",\n\r;]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
const linhas = ["ibge_code,name,uf,region,population,population_year"];
for (const m of municipios) {
  const uf = m.microrregiao?.mesorregiao?.UF ?? m["regiao-imediata"]?.["regiao-intermediaria"]?.UF;
  if (!uf) throw new Error(`município ${m.id} sem UF na resposta do IBGE`);
  const pop = populacao.get(String(m.id)) ?? "";
  linhas.push([String(m.id), m.nome, uf.sigla, uf.regiao.nome, pop, pop ? ano : ""].map(esc).join(","));
}
const csv = linhas.join("\n") + "\n";
const saida = process.argv[2] ?? "ibge-municipios.csv";
writeFileSync(saida, csv);
console.log(`${municipios.length} municípios, ${populacao.size} com população (período ${ano}); sha256 ${createHash("sha256").update(csv).digest("hex")}; arquivo ${saida}`);
