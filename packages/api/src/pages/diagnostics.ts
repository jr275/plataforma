import { CITY_OVERVIEW, type CityTemplate, type FactKey, type RenderedPage } from "./city-overview";

// Diagnósticos PUROS de uma página renderizada (alimentam a interface; não são gates): o que foi omitido por falta de fato e quais fatos
// merecem revisão. Nada é inventado: a lista vem do contrato do template e dos fatos realmente usados.

export interface Omission {
  readonly sectionId: string;
  readonly heading: string;
  /** `true` = a seção inteira saiu; `false` = só um parágrafo dela saiu. */
  readonly wholeSection: boolean;
  /** Fatos que faltaram (de `requires` do parágrafo). */
  readonly missing: readonly FactKey[];
}

export const FACT_LABELS: Readonly<Record<FactKey, string>> = { name: "Nome", uf: "UF", region: "Região", population: "População estimada", population_year: "Ano da estimativa", ibge_code: "Código IBGE" };

/** O que o template previa e a página NÃO tem, por falta de fato. Vazio = nada foi omitido. */
export function describeOmissions(page: RenderedPage, template: CityTemplate = CITY_OVERVIEW): Omission[] {
  const have = new Set(page.factsUsed.map((f) => f.key));
  const present = new Map(page.sections.map((s) => [s.id, s]));
  const out: Omission[] = [];
  for (const s of template.sections) {
    const rendered = present.get(s.id);
    const missingParagraphs = s.paragraphs.filter((p) => !p.requires.every((k) => have.has(k)));
    if (missingParagraphs.length === 0) continue;
    const missing = [...new Set(missingParagraphs.flatMap((p) => p.requires.filter((k) => !have.has(k))))];
    out.push({ sectionId: s.id, heading: s.heading, wholeSection: rendered === undefined, missing });
  }
  return out;
}

/** Idade, em dias inteiros, entre a data de coleta (`YYYY-MM-DD`) e `today`. Não usa o relógio: o chamador informa `today`. */
export function ageInDays(collectedAt: string, today: Date): number {
  const t = Date.UTC(Number(collectedAt.slice(0, 4)), Number(collectedAt.slice(5, 7)) - 1, Number(collectedAt.slice(8, 10)));
  const n = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((n - t) / 86_400_000);
}

/** Limite configurável (explícito): fatos coletados há mais dias que isto aparecem como "revisar". É um AVISO, não um gate. */
export const FACT_REVIEW_AFTER_DAYS = 365;

export interface FactReview { readonly factId: string; readonly label: string; readonly collectedAt: string; readonly ageDays: number; readonly review: boolean }

export function reviewFacts(page: RenderedPage, today: Date, reviewAfterDays: number = FACT_REVIEW_AFTER_DAYS): FactReview[] {
  return page.factsUsed.map((f) => {
    const ageDays = ageInDays(f.source.collectedAt, today);
    return { factId: f.id, label: FACT_LABELS[f.key], collectedAt: f.source.collectedAt, ageDays, review: ageDays > reviewAfterDays };
  });
}
