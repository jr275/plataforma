import type { QaBundle, QaCheck, QaId, QaOutcome, QaStatus } from "./types";
import { BLOCKING, QA_IDS } from "./types";
import type { RecipeBlock } from "../recipe/types";

// Verificações do CÓDIGO (puras e determinísticas). Número só vale se existir nos fatos do recipe (Q1); toda afirmação factual cita fatos existentes (Q2); etc.
const DAY = 86_400_000;
const pass = (id: QaId, detail: string): QaCheck => ({ status: "PASS", by: "code", blocking: BLOCKING.has(id), issues: [], detail });
const fail = (id: QaId, issues: string[], detail: string): QaCheck => ({ status: "FAIL", by: "code", blocking: BLOCKING.has(id), issues, detail });
const notRun = (id: QaId, detail: string): QaCheck => ({ status: "NOT_RUN", by: "none", blocking: BLOCKING.has(id), issues: [], detail });
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const REF = /\[[^\]]+\]/g;
const textBlocks = (b: QaBundle): RecipeBlock[] => b.recipe.blocks.filter((x) => x.kind === "paragraph" || x.kind === "insufficiency" || x.kind === "sources");
const plain = (t: string) => t.replace(REF, "").trim();
const pageText = (b: QaBundle) => [b.recipe.title, b.recipe.h1, b.recipe.metaDescription, ...b.recipe.blocks.map((x) => plain(x.text))].join("\n");

/** Números do texto no padrão pt-BR → valores (1.234,5 → 1234.5). Anos isolados (19xx/20xx) entram como ano. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/g)].map((m) => Number(m[0].replace(/\./g, "").replace(",", ".")));
}
const allowedNumbers = (b: QaBundle): Set<string> => {
  const s = new Set<string>(); const add = (n: number) => { for (const d of [0, 1, 2]) s.add(n.toFixed(d)); s.add(String(n)); };
  for (const f of b.recipe.facts) { if (typeof f.value === "number") add(f.value); const y = new Date(f.observedAt).getUTCFullYear(); if (!Number.isNaN(y)) add(y); }
  for (const m of b.recipe.modules) add(m.minItems); return s;
};

export function q1(b: QaBundle): QaCheck {
  const ok = allowedNumbers(b); const issues: string[] = [];
  for (const blk of b.recipe.blocks.filter((x) => x.kind !== "sources")) for (const n of numbersIn(plain(blk.text))) if (!ok.has(String(n)) && !ok.has(n.toFixed(0)) && !ok.has(n.toFixed(1)) && !ok.has(n.toFixed(2))) issues.push(`${blk.blockId}: o número ${n} não existe nos fatos do recipe`);
  for (const n of numbersIn(`${b.recipe.title} ${b.recipe.metaDescription} ${b.recipe.h1}`)) if (!ok.has(String(n)) && !ok.has(n.toFixed(0)) && !ok.has(n.toFixed(2))) issues.push(`metadados: o número ${n} não existe nos fatos`);
  return issues.length ? fail("Q1", issues, "números do texto sem fato correspondente") : pass("Q1", "todo número do texto existe nos fatos do recipe (nomes próprios são conferidos pelo Agente 8)");
}
export function q2(b: QaBundle): QaCheck {
  const ids = new Set(b.recipe.facts.map((f) => f.factId)); const issues: string[] = [];
  for (const blk of textBlocks(b)) {
    if (blk.kind === "insufficiency") continue;
    const nums = numbersIn(plain(blk.text));
    if (nums.length > 0 && blk.refs.length === 0) issues.push(`${blk.blockId}: afirmação com número e sem referência de fato`);
    for (const r of blk.refs) if (!ids.has(r)) issues.push(`${blk.blockId}: referência inexistente ${r}`);
    const inline = [...blk.text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!); for (const r of inline) if (!ids.has(r)) issues.push(`${blk.blockId}: referência [${r}] no texto não existe`);
  }
  return issues.length ? fail("Q2", issues, "afirmação factual sem proveniência válida") : pass("Q2", "toda afirmação factual tem referência de fato existente");
}
export function q3(b: QaBundle): QaCheck {
  const issues: string[] = [];
  for (const m of b.recipe.modules) {
    if (m.status === "RICH" && m.render !== "RENDERED") issues.push(`módulo ${m.moduleId} está RICH mas não foi renderizado`);
    if (m.status === "DATA_PENDING" && m.minItems > 0 && m.onMissing === "show_insufficiency" && m.render !== "INSUFFICIENCY_SHOWN") issues.push(`módulo ${m.moduleId} sem dado deveria mostrar a insuficiência`);
    if (m.status === "DATA_PENDING" && m.render === "RENDERED") issues.push(`módulo ${m.moduleId} sem dado foi renderizado (R9)`);
  }
  return issues.length ? fail("Q3", issues, "módulos obrigatórios incompletos") : pass("Q3", "módulos RICH renderizados; os sem dado removidos ou com a insuficiência declarada");
}
// 5-gramas de palavras, sem acento, sem o nome do lugar e sem números/valores: a "forma" do texto
const shape = (text: string, names: readonly string[], values: readonly string[]): string[] => {
  let t = fold(text);
  for (const n of [...names, ...values].sort((a, c) => c.length - a.length)) if (n.trim()) t = t.split(fold(n)).join(" ");
  return t.replace(/\d+([.,]\d+)*/g, " ").split(/[^a-z]+/).filter(Boolean);
};
const shingles = (w: readonly string[], k: number): Set<string> => { const s = new Set<string>(); for (let i = 0; i + k <= w.length; i++) s.add(w.slice(i, i + k).join(" ")); return s; };
const jacc = (a: Set<string>, c: Set<string>) => { if (a.size === 0 && c.size === 0) return 1; let i = 0; for (const x of a) if (c.has(x)) i++; return i / (a.size + c.size - i); };
const valueStrings = (b: QaBundle) => b.recipe.facts.map((f) => String(f.value));
export function q4(b: QaBundle): QaCheck {
  if (b.siblings.length < b.policy.minSiblingsForComparison) return notRun("Q4", `precisa de ${b.policy.minSiblingsForComparison} páginas irmãs compiladas para comparar (há ${b.siblings.length})`);
  const mine = shingles(shape(pageText(b), b.recipe.entities.map((e) => e.name), valueStrings(b)), b.policy.shingleSize);
  const issues = b.siblings.map((s) => ({ s, sim: jacc(mine, shingles(shape(s.text, s.entityNames, s.values ?? []), b.policy.shingleSize)) })).filter((x) => x.sim > b.policy.maxSiblingSimilarity).map((x) => `${x.s.pageId.slice(0, 8)}: similaridade ${x.sim.toFixed(2)} > ${b.policy.maxSiblingSimilarity} (sem o nome do lugar)`);
  return issues.length ? fail("Q4", issues, "quase idêntica às páginas irmãs, tirando o nome do lugar") : pass("Q4", `similaridade com ${b.siblings.length} irmã(s) ≤ ${b.policy.maxSiblingSimilarity}`);
}
export function variableShare(b: QaBundle): number {
  const body = b.recipe.blocks.filter((x) => x.kind === "paragraph").map((x) => plain(x.text)).join(" ");
  const words = fold(body).split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return 0;
  const variable = new Set(fold([...b.recipe.entities.map((e) => e.name), ...valueStrings(b)].join(" ")).split(/[^a-z0-9]+/).filter(Boolean));
  return words.filter((w) => variable.has(w) || /^\d+$/.test(w)).length / words.length;
}
export function q5(b: QaBundle): QaCheck {
  const share = variableShare(b);
  return share < b.policy.minVariableShare ? fail("Q5", [`parcela variável ${(share * 100).toFixed(1)}% < ${b.policy.minVariableShare * 100}%`], "conteúdo fino: pouco do texto varia por instância") : pass("Q5", `parcela variável ${(share * 100).toFixed(1)}% ≥ ${b.policy.minVariableShare * 100}%`);
}
export function q6(b: QaBundle): QaCheck {
  return b.competing.length > 0 ? fail("Q6", b.competing.map((c) => `já existe a página indexável ${c.url} para o mesmo cluster de intenção`), "canibalização") : pass("Q6", "nenhuma outra página indexável para o mesmo cluster (nenhuma página está publicada)");
}
export function q7(b: QaBundle): QaCheck {
  const ufs = new Set(b.recipe.entities.map((e) => e.uf).filter((x): x is string => !!x));
  const unknown = b.recipe.entities.filter((e) => !e.uf);
  if (b.recipe.entities.length > 1 && unknown.length > 0) return fail("Q7", [`UF desconhecida para ${unknown.map((e) => e.name).join(", ")}: não dá para garantir a coerência`], "geografia não verificável");
  return ufs.size > 1 ? fail("Q7", [`entidades de estados diferentes: ${[...ufs].join(", ")}`], "conflito geográfico") : pass("Q7", "as entidades citadas pertencem à mesma geografia");
}
export function q8(b: QaBundle): QaCheck {
  if (b.recipe.travelTime) return pass("Q8", `tempo de deslocamento permitido: há fonte de roteamento (${b.recipe.travelTime.source})`);
  const hits: string[] = []; const text = pageText(b);
  for (const p of b.policy.travelTimePatterns) { const m = new RegExp(p, "iu").exec(text); if (m) hits.push(`expressão de tempo de deslocamento sem fonte de roteamento: “${m[0]}”`); }
  return hits.length ? fail("Q8", hits, "R3: distância não é tempo") : pass("Q8", "nenhuma expressão de tempo de deslocamento (apenas distâncias com unidade, se houver)");
}
export function q9(b: QaBundle): QaCheck {
  const bad = b.recipe.links.filter((l) => !b.knownPaths.has(l.path)).map((l) => `link quebrado: ${l.path}`);
  if (b.recipe.url && b.recipe.links.some((l) => l.path === b.recipe.url)) bad.push("a página aponta para si mesma");
  return bad.length ? fail("Q9", bad, "links internos inválidos") : pass("Q9", `${b.recipe.links.length} link(s) interno(s), todos para destinos existentes`);
}
export function q10(b: QaBundle): QaCheck {
  const issues: string[] = []; const types = new Set(b.recipe.jsonLd.map((x) => String(x["@type"])));
  for (const want of b.blueprint.schema_requirements) if (!types.has(want)) issues.push(`tipo declarado no blueprint ausente: ${want}`);
  for (const j of b.recipe.jsonLd) {
    if (j["@context"] !== "https://schema.org") issues.push(`${String(j["@type"])}: @context inválido`);
    const req = b.policy.jsonLdRequired[String(j["@type"])]; if (!req) { issues.push(`tipo sem regra de validação: ${String(j["@type"])}`); continue; }
    for (const k of req) { const v = j[k]; if (v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0)) issues.push(`${String(j["@type"])}: propriedade obrigatória ausente: ${k}`); }
  }
  const text = fold(pageText(b));
  for (const j of b.recipe.jsonLd) if (j["@type"] === "City" && typeof j.name === "string" && !text.includes(fold(j.name))) issues.push("City.name não aparece no texto da página");
  return issues.length ? fail("Q10", issues, "JSON-LD inválido ou incoerente") : pass("Q10", `JSON-LD válido para ${[...types].join(", ") || "nenhum tipo"}`);
}
export function q11(b: QaBundle): QaCheck {
  const issues: string[] = []; const r = b.recipe;
  if (r.robots !== b.blueprint.indexability_policy) issues.push(`robots (${r.robots}) difere da política do blueprint (${b.blueprint.indexability_policy})`);
  if (b.blueprint.canonical_policy === "self" && r.canonical !== r.url) issues.push(`canonical (${r.canonical}) difere da URL (${r.url})`);
  if (r.url === null && r.robots === "index") issues.push("página indexável sem URL definida");
  if (r.robots !== "noindex") issues.push("nesta fase toda página compilada deve ser noindex (nada é publicado)");
  return issues.length ? fail("Q11", issues, "canonical/indexação incoerentes") : pass("Q11", "canonical e robots coerentes com o blueprint (noindex)");
}
export function q12(b: QaBundle): QaCheck {
  const ref = new Date(b.referenceTime).getTime(); const issues: string[] = [];
  const reqMax = new Map(b.blueprint.evidence_requirements.map((e) => [e.claim_type, e.max_age_days] as const));
  void reqMax;
  for (const f of b.recipe.facts) { const max = f.maxAgeDays; if (max !== null && (ref - new Date(f.observedAt).getTime()) / DAY > max) issues.push(`${f.factId}: ${Math.floor((ref - new Date(f.observedAt).getTime()) / DAY)} dias > ${max}`); }
  return issues.length ? fail("Q12", issues, "dados acima da validade") : pass("Q12", "todos os fatos dentro da validade");
}
export function q13(b: QaBundle): QaCheck {
  const issues: string[] = []; const text = pageText(b);
  for (const c of b.policy.forbiddenClaims) { const m = new RegExp(c.pattern, "iu").exec(text); if (m) issues.push(`${c.rule} (${c.id}): “${m[0]}”`); }
  const unsourced = b.recipe.blocks.filter((x) => x.kind === "paragraph" && /\b(fundad[ao]|história|historicamente|século)\b/i.test(x.text) && x.refs.length === 0);
  for (const u of unsourced) issues.push(`R10: afirmação histórica sem fonte em ${u.blockId}`);
  return issues.length ? fail("Q13", issues, "política editorial violada") : pass("Q13", "sem score apresentado como oficial, atribuição social, conteúdo de terceiros ou história sem fonte");
}
export const q14 = (): QaCheck => notRun("Q14", "exige o verificador de utilidade (Agente 8, LLM); sem ele a utilidade NÃO é presumida");

const CHECKS: Record<QaId, (b: QaBundle) => QaCheck> = { Q1: q1, Q2: q2, Q3: q3, Q4: q4, Q5: q5, Q6: q6, Q7: q7, Q8: q8, Q9: q9, Q10: q10, Q11: q11, Q12: q12, Q13: q13, Q14: q14 };
export function runCodeChecks(b: QaBundle): Record<QaId, QaCheck> { return Object.fromEntries(QA_IDS.map((id) => [id, CHECKS[id](b)])) as Record<QaId, QaCheck>; }

/** Funde o parecer do Agente 8 (conservador: qualquer FAIL, do código ou do agente, vale) e calcula o desfecho. Q14 só passa com o verificador. */
export function mergeVerifier(code: Record<QaId, QaCheck>, llm: Partial<Record<QaId, { result: "PASS" | "FAIL"; issues: readonly string[] }>> | null): Record<QaId, QaCheck> {
  if (!llm) return code;
  const out = { ...code } as Record<QaId, QaCheck>;
  for (const id of Object.keys(llm) as QaId[]) {
    const l = llm[id]!; const c = code[id];
    const status: QaStatus = c.status === "FAIL" || l.result === "FAIL" ? "FAIL" : id === "Q14" ? "PASS" : c.status;
    out[id] = { status, by: id === "Q14" ? "llm" : "both", blocking: BLOCKING.has(id), issues: [...c.issues, ...l.issues], detail: l.result === "FAIL" ? `${c.detail}; o verificador reprovou` : c.detail };
  }
  return out;
}
export function outcomeOf(r: Record<QaId, QaCheck>): { outcome: QaOutcome; blocking: QaId[] } {
  const failed = QA_IDS.filter((id) => r[id].status === "FAIL");
  const blocking = failed.filter((id) => BLOCKING.has(id));
  if (failed.length > 0) return { outcome: "QA_FAILED", blocking };
  return { outcome: QA_IDS.some((id) => r[id].status === "NOT_RUN") ? "QA_INCOMPLETE" : "QA_PASSED", blocking: [] };
}
