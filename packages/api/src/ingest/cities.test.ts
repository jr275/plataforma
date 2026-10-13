import { describe, expect, it } from "vitest";
import { classifyCityRows, ibgeCheckDigitOk, MappingError, validateMapping, type CityMapping } from "./cities";
import { parseCsv } from "./csv";

// Casos REAIS do IBGE (API de localidades, 2026-10-12) e casos inválidos fabricados para cada regra.
const M: CityMapping = { ibge_code: "ibge_code", name: "name", uf: "uf", region: "region", population: "population", population_year: "population_year" };
const HEADER = "ibge_code,name,uf,region,population,population_year";
const classify = (body: string, mapping: CityMapping = M, head = HEADER) => classifyCityRows(parseCsv(`${head}\n${body}`), mapping);

describe("dígito verificador do código IBGE", () => {
  it("confere em municípios normais e não confere em casos reais conhecidos", () => {
    expect(ibgeCheckDigitOk("1100015")).toBe(true); // Alta Floresta D'Oeste
    expect(ibgeCheckDigitOk("3550308")).toBe(true); // São Paulo
    for (const c of ["2201919", "2201988", "2202251"]) expect(ibgeCheckDigitOk(c)).toBe(false); // municípios reais do Piauí
  });
});

describe("classificação de linhas de cidades", () => {
  it("aceita linhas válidas e normaliza UF e região", () => {
    const r = classify("1100015,Alta Floresta D'Oeste,ro,norte,22724,2026\n3550308,São Paulo,SP,Sudeste,12000000,2026");
    expect(r.counts).toMatchObject({ total: 2, accepted: 2, rejected: 0, duplicate: 0 });
    expect(r.rows[0]!.city).toEqual({ ibgeCode: "1100015", name: "Alta Floresta D'Oeste", uf: "RO", region: "Norte", population: 22724, populationYear: 2026 });
  });

  it("município real com dígito verificador que não confere é ACEITO, com aviso (não rejeitado)", () => {
    const r = classify("2201919,Bom Princípio do Piauí,PI,Nordeste,5000,2026");
    expect(r.rows[0]!.outcome).toBe("accepted");
    expect(r.rows[0]!.issues).toEqual([expect.objectContaining({ code: "ibge_check_digit_mismatch", severity: "warning" })]);
    expect(r.counts.warnings).toBe(1);
  });

  it("campos opcionais vazios viram null e a linha continua válida", () => {
    const r = classify("5101837,Boa Esperança do Norte,MT,,,");
    expect(r.rows[0]!.outcome).toBe("accepted");
    expect(r.rows[0]!.city).toMatchObject({ region: null, population: null, populationYear: null });
  });

  it("rejeita com TODOS os motivos de uma vez", () => {
    const r = classify(",,XX,Oeste,1.234,1800");
    const codes = r.rows[0]!.issues.map((i) => `${i.field}:${i.code}`).sort();
    expect(r.rows[0]!.outcome).toBe("rejected");
    expect(codes).toEqual(["ibge_code:required", "name:required", "population:invalid_integer", "population_year:invalid_year", "region:invalid_value", "uf:invalid_value"]);
    expect(r.rows[0]!.city).toBeUndefined();
  });

  it("recusa código fora de 7 dígitos, população negativa e nome longo", () => {
    expect(classify("123,Cidade,SP,,,").rows[0]!.issues[0]).toMatchObject({ code: "invalid_format" });
    expect(classify("1100015,Cidade,SP,,-5,").rows[0]!.issues.map((i) => i.code)).toContain("invalid_integer");
    expect(classify(`1100015,${"x".repeat(121)},SP,,,`).rows[0]!.issues.map((i) => i.code)).toContain("too_long");
  });

  it("número de colunas diferente do cabeçalho rejeita a linha e preserva o excedente", () => {
    const r = classify("1100015,Cidade,SP,Sudeste,10,2026,sobra,mais");
    expect(r.rows[0]!.outcome).toBe("rejected");
    expect(r.rows[0]!.issues.map((i) => i.code)).toContain("column_count");
    expect(r.rows[0]!.raw["_extra"]).toBe("sobra|mais");
    expect(classify("1100015,Cidade,SP").rows[0]!.issues.map((i) => i.code)).toContain("column_count");
  });

  it("a segunda ocorrência do mesmo código no arquivo é duplicada; se a primeira foi rejeitada, a seguinte vale", () => {
    const r = classify("1100015,A,RO,,,\n1100015,A de novo,RO,,,\n1100023,,RO,,,\n1100023,Ariquemes,RO,,,");
    expect(r.rows.map((x) => x.outcome)).toEqual(["accepted", "duplicate", "rejected", "accepted"]);
    expect(r.rows[1]!.issues.map((i) => i.code)).toContain("duplicate_in_file");
    expect(r.counts).toMatchObject({ total: 4, accepted: 2, rejected: 1, duplicate: 1 });
  });

  it("100% das linhas ficam classificadas: aceitas + rejeitadas + duplicadas = total", () => {
    const body = Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? ",x,SP,,," : i % 7 === 0 ? "1100015,dup,SP,,," : `${1100000 + i},n${i},SP,,,`)).join("\n");
    const { counts, rows } = classify(body);
    expect(counts.accepted + counts.rejected + counts.duplicate).toBe(counts.total);
    expect(rows).toHaveLength(50);
    expect(rows.every((r) => r.rowNumber >= 1)).toBe(true);
  });

  it("guarda a linha original (raw) de cada registro", () => {
    expect(classify("1100015,Cidade,SP,Sul,10,2026").rows[0]!.raw).toEqual({ ibge_code: "1100015", name: "Cidade", uf: "SP", region: "Sul", population: "10", population_year: "2026" });
  });
});

describe("mapeamento de colunas", () => {
  const pt: CityMapping = { ibge_code: "codigo_ibge", name: "municipio", uf: "sigla", population: "populacao" };

  it("lê arquivos com outros nomes de coluna e ignora colunas não mapeadas", () => {
    const r = classifyCityRows(parseCsv("codigo_ibge;municipio;sigla;populacao;observacao\n1100015;Alta Floresta D'Oeste;RO;22724;ignorar"), pt);
    expect(r.rows[0]!.outcome).toBe("accepted");
    expect(r.rows[0]!.city).toMatchObject({ ibgeCode: "1100015", population: 22724, region: null });
  });

  it("campo obrigatório sem coluna, coluna inexistente, ambígua ou reusada impedem a execução ANTES de ler linhas", () => {
    expect(validateMapping(["a", "b"], { name: "a" }).map((i) => i.code)).toEqual(expect.arrayContaining(["mapping_missing"]));
    expect(validateMapping(["codigo", "nome", "uf"], { ibge_code: "codigo", name: "nome", uf: "estado" }).map((i) => i.code)).toContain("column_not_found");
    expect(validateMapping(["a", "a", "b"], { ibge_code: "a", name: "b", uf: "b" }).map((i) => i.code)).toEqual(expect.arrayContaining(["column_ambiguous", "column_reused"]));
    expect(() => classifyCityRows(parseCsv("x,y\n1,2"), M)).toThrowError(MappingError);
  });
});
