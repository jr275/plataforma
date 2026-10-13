import type { ParsedCsv } from "./csv";

// Classificação das linhas de um CSV de cidades (ADR-017). PURA: não fala com o banco. 100% das linhas saem classificadas em
// `accepted`, `rejected` ou `duplicate`, cada uma com TODOS os motivos; nada é descartado em silêncio.

export const CITY_FIELDS = ["ibge_code", "name", "uf", "region", "population", "population_year"] as const;
export const REQUIRED_CITY_FIELDS = ["ibge_code", "name", "uf"] as const;
export type CityField = (typeof CITY_FIELDS)[number];
/** Campo → nome da coluna no arquivo de origem. Só as colunas mapeadas são lidas. */
export type CityMapping = Partial<Record<CityField, string>>;

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
export const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;

export interface Issue {
  readonly field: string;
  readonly code: string;
  /** `error` bloqueia a linha; `warning` fica registrado e NÃO bloqueia. */
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface CityInput {
  readonly ibgeCode: string;
  readonly name: string;
  readonly uf: string;
  readonly region: string | null;
  readonly population: number | null;
  readonly populationYear: number | null;
}

export type RowOutcome = "accepted" | "rejected" | "duplicate";

export interface ClassifiedRow {
  /** Posição da linha de dados, a partir de 1 (a linha do cabeçalho não conta). */
  readonly rowNumber: number;
  /** A linha como lida: cabeçalho → célula (células a mais, se houver, ficam em `_extra`). */
  readonly raw: Readonly<Record<string, string>>;
  readonly outcome: RowOutcome;
  readonly issues: readonly Issue[];
  readonly city?: CityInput;
}

export interface Classification {
  readonly rows: readonly ClassifiedRow[];
  readonly counts: { readonly total: number; readonly accepted: number; readonly rejected: number; readonly duplicate: number; readonly warnings: number };
}

const err = (field: string, code: string, message: string): Issue => ({ field, code, severity: "error", message });
const warn = (field: string, code: string, message: string): Issue => ({ field, code, severity: "warning", message });

/** Erros de mapeamento (impedem a execução ANTES de processar qualquer linha). */
export function validateMapping(header: readonly string[], mapping: CityMapping): Issue[] {
  const issues: Issue[] = [];
  for (const field of REQUIRED_CITY_FIELDS) {
    const col = mapping[field];
    if (!col) issues.push(err(field, "mapping_missing", `o campo obrigatório "${field}" não foi mapeado a nenhuma coluna`));
  }
  const seen = new Map<string, number>();
  for (const h of header) seen.set(h, (seen.get(h) ?? 0) + 1);
  for (const field of CITY_FIELDS) {
    const col = mapping[field];
    if (col === undefined) continue;
    if (!seen.has(col)) issues.push(err(field, "column_not_found", `a coluna "${col}" (campo "${field}") não existe no cabeçalho`));
    else if ((seen.get(col) ?? 0) > 1) issues.push(err(field, "column_ambiguous", `a coluna "${col}" aparece mais de uma vez no cabeçalho`));
  }
  const used = CITY_FIELDS.map((f) => mapping[f]).filter((c): c is string => Boolean(c));
  if (new Set(used).size !== used.length) issues.push(err("mapping", "column_reused", "a mesma coluna foi mapeada a mais de um campo"));
  return issues;
}

/** Dígito verificador do código IBGE (módulo 10, pesos 1 e 2). 9 municípios reais NÃO conferem: por isso é só aviso. */
export function ibgeCheckDigitOk(code: string): boolean {
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    const p = Number(code[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 10) + (p % 10);
  }
  return (10 - (sum % 10)) % 10 === Number(code[6]);
}

const INT = /^\d{1,10}$/;

function readRow(header: readonly string[], cells: readonly string[]): { raw: Record<string, string>; mismatch: boolean } {
  const raw: Record<string, string> = {};
  header.forEach((h, i) => {
    raw[h] = cells[i] ?? "";
  });
  const mismatch = cells.length !== header.length;
  if (cells.length > header.length) raw["_extra"] = cells.slice(header.length).join("|");
  return { raw, mismatch };
}

function validateRow(raw: Readonly<Record<string, string>>, mapping: CityMapping, mismatch: boolean): { issues: Issue[]; city?: CityInput } {
  const issues: Issue[] = [];
  if (mismatch) issues.push(err("row", "column_count", "a linha tem um número de colunas diferente do cabeçalho"));
  const get = (f: CityField): string => (mapping[f] ? (raw[mapping[f] as string] ?? "").trim() : "");

  const code = get("ibge_code");
  if (code === "") issues.push(err("ibge_code", "required", "código IBGE ausente"));
  else if (!/^\d{7}$/.test(code)) issues.push(err("ibge_code", "invalid_format", `código IBGE deve ter 7 dígitos (veio "${code}")`));

  const name = get("name");
  if (name === "") issues.push(err("name", "required", "nome do município ausente"));
  else if (name.length > 120) issues.push(err("name", "too_long", "nome do município passa de 120 caracteres"));

  const ufRaw = get("uf").toUpperCase();
  if (ufRaw === "") issues.push(err("uf", "required", "UF ausente"));
  else if (!(UFS as readonly string[]).includes(ufRaw)) issues.push(err("uf", "invalid_value", `UF inexistente ("${get("uf")}")`));

  let region: string | null = null;
  const regionRaw = get("region");
  if (regionRaw !== "") {
    const match = REGIONS.find((r) => r.toLowerCase() === regionRaw.toLowerCase());
    if (match) region = match;
    else issues.push(err("region", "invalid_value", `região fora das 5 regiões do IBGE ("${regionRaw}")`));
  }

  let population: number | null = null;
  const popRaw = get("population");
  if (popRaw !== "") {
    if (!INT.test(popRaw)) issues.push(err("population", "invalid_integer", `população deve ser um inteiro sem separadores (veio "${popRaw}")`));
    else population = Number(popRaw);
  }

  let populationYear: number | null = null;
  const yearRaw = get("population_year");
  if (yearRaw !== "") {
    if (!/^\d{4}$/.test(yearRaw) || Number(yearRaw) < 1900 || Number(yearRaw) > 2200) issues.push(err("population_year", "invalid_year", `ano fora de 1900 a 2200 ("${yearRaw}")`));
    else populationYear = Number(yearRaw);
  }
  if (population !== null && populationYear === null && mapping.population_year) issues.push(warn("population_year", "year_missing", "população informada sem o ano de referência"));

  if (/^\d{7}$/.test(code) && !ibgeCheckDigitOk(code)) {
    issues.push(warn("ibge_code", "ibge_check_digit_mismatch", "o dígito verificador do código IBGE não confere (existem municípios reais nessa situação)"));
  }

  if (issues.some((i) => i.severity === "error")) return { issues };
  return { issues, city: { ibgeCode: code, name, uf: ufRaw, region, population, populationYear } };
}

export function classifyCityRows(parsed: ParsedCsv, mapping: CityMapping): Classification {
  const blocking = validateMapping(parsed.header, mapping).filter((i) => i.severity === "error");
  if (blocking.length > 0) throw new MappingError(blocking);

  const seen = new Set<string>();
  const rows: ClassifiedRow[] = [];
  parsed.rows.forEach((cells, index) => {
    const { raw, mismatch } = readRow(parsed.header, cells);
    const { issues, city } = validateRow(raw, mapping, mismatch);
    const rowNumber = index + 1;
    if (!city) {
      rows.push({ rowNumber, raw, outcome: "rejected", issues });
      return;
    }
    if (seen.has(city.ibgeCode)) {
      rows.push({ rowNumber, raw, outcome: "duplicate", issues: [...issues, err("ibge_code", "duplicate_in_file", `o código ${city.ibgeCode} já apareceu antes neste arquivo`)] });
      return;
    }
    seen.add(city.ibgeCode);
    rows.push({ rowNumber, raw, outcome: "accepted", issues, city });
  });

  const count = (o: RowOutcome) => rows.filter((r) => r.outcome === o).length;
  return {
    rows,
    counts: {
      total: rows.length,
      accepted: count("accepted"),
      rejected: count("rejected"),
      duplicate: count("duplicate"),
      warnings: rows.reduce((n, r) => n + r.issues.filter((i) => i.severity === "warning").length, 0),
    },
  };
}

export class MappingError extends Error {
  readonly code = "INGEST_MAPPING";
  readonly issues: readonly Issue[];
  constructor(issues: readonly Issue[]) {
    super(`mapeamento inválido: ${issues.map((i) => i.message).join("; ")}`);
    this.name = "MappingError";
    this.issues = issues;
  }
}
