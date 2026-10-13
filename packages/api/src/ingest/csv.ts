// Leitor de CSV sem dependências (RFC 4180 com o que importa na prática): aspas, aspas escapadas (""), quebras de linha dentro de
// aspas, CRLF/LF/CR, BOM e separador `,`, `;` ou tab. Nunca descarta nada em silêncio: linhas totalmente vazias são ignoradas (não
// são registros) e tudo o que não der para ler vira CsvParseError com a linha.

export type Delimiter = "," | ";" | "\t";

export class CsvParseError extends Error {
  readonly code = "CSV_PARSE";
  readonly reason: "unterminated_quote" | "too_many_rows" | "empty_file" | "invalid_delimiter";
  readonly line: number | undefined;
  constructor(reason: CsvParseError["reason"], message: string, line?: number) {
    super(message);
    this.name = "CsvParseError";
    this.reason = reason;
    this.line = line;
  }
}

export interface ParsedCsv {
  readonly delimiter: Delimiter;
  readonly header: readonly string[];
  /** Linhas de dados, na ordem do arquivo; cada célula como lida (sem `trim`). */
  readonly rows: readonly (readonly string[])[];
}

/** Escolhe o separador pela primeira linha: o mais frequente entre `,` `;` e tab (empate favorece a vírgula). */
export function detectDelimiter(text: string): Delimiter {
  const first = text.replace(/^﻿/, "").split(/\r\n|\n|\r/, 1)[0] ?? "";
  const count = (d: string) => first.split(d).length - 1;
  const candidates: Delimiter[] = [",", ";", "\t"];
  return candidates.reduce((best, d) => (count(d) > count(best) ? d : best), ",");
}

export function parseCsv(text: string, options: { delimiter?: Delimiter; maxRows?: number } = {}): ParsedCsv {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  if (delimiter !== "," && delimiter !== ";" && delimiter !== "\t") throw new CsvParseError("invalid_delimiter", "separador inválido");
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const src = text.replace(/^﻿/, "");

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let quoteLine = 1;
  let line = 1;
  let pending = false; // há conteúdo na linha corrente (campo iniciado, aspas ou separador)

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    if (pending || record.length > 0 || field.length > 0) {
      endField();
      const blank = record.length === 1 && record[0] === "";
      if (!blank) records.push(record);
    }
    record = [];
    pending = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      quoteLine = line;
      pending = true;
    } else if (ch === delimiter) {
      endField();
      pending = true;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRecord();
      line++;
      if (records.length - 1 > maxRows) throw new CsvParseError("too_many_rows", `o arquivo tem mais de ${maxRows} linhas de dados`, line);
    } else {
      field += ch;
      pending = true;
    }
  }
  if (inQuotes) throw new CsvParseError("unterminated_quote", "aspas abertas que nunca fecham", quoteLine);
  endRecord();

  const header = records.shift();
  if (!header) throw new CsvParseError("empty_file", "o arquivo está vazio");
  if (records.length > maxRows) throw new CsvParseError("too_many_rows", `o arquivo tem mais de ${maxRows} linhas de dados`);
  return { delimiter, header: header.map((h) => h.trim()), rows: records };
}
