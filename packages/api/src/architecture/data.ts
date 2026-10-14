import { z } from "zod";
import type { DensitySignal, RuleSpec } from "./types";

// Fragmentos reutilizáveis dos contratos de dado dos archetypes. O schema valida FORMA; presença de fonte, qualidade e densidade são camadas próprias (validate.ts).
export const S = z.string().trim();
export const ISO = S.regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/, "data ISO");
export const slug = S.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug em minúsculas com hífens");
export const coords = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), precision: z.enum(["exact", "street", "neighborhood", "city"]).optional() }).strict();
export const identity = z.object({ name: S.min(1).max(200), slug }).strict();
export const adminLevel = z.object({ level: z.enum(["country", "state", "region", "city", "district", "neighborhood"]), name: S.min(1) }).strict();
export const location = z.object({ adminHierarchy: z.array(adminLevel).min(1), coordinates: coords.optional() }).strict();
export const image = z.object({ url: S.regex(/^https?:\/\//), alt: S.optional() }).strict();
/** Métrica com valor e (opcionalmente no SCHEMA) a origem: a FONTE é exigida pela camada de proveniência, não pelo formato. */
export const metric = z.object({ id: S.min(1), value: z.number(), unit: S.optional(), source: S.optional(), verifiedAt: ISO.optional(), validUntil: ISO.optional(), method: S.optional() }).strict();
export const faq = z.object({ category: S.optional(), question: S.min(5), answer: S.min(10) }).strict();
export const related = z.object({ id: S.min(1), relation: S.min(1) }).strict();
export const source = z.object({ source: S.optional(), sourceUrl: S.regex(/^https?:\/\//).optional(), verifiedAt: ISO.optional() });
export const AMENITY_CATEGORIES = ["education", "mobility", "health", "gastronomy", "retail_shopping", "parks_recreation", "safety"] as const;
export const amenity = z.object({ name: S.min(1), distanceM: z.number().nonnegative().optional(), source: S.optional(), verifiedAt: ISO.optional() }).strict();
export const station = z.object({ name: S.min(1), kind: S.min(1), distanceM: z.number().nonnegative().optional(), walkMinutes: z.number().nonnegative().optional(), routingSource: S.optional(), source: S.optional() }).strict();
export const offer = z.object({ price: z.number().nonnegative(), priceCurrency: S.regex(/^[A-Z]{3}$/), source: S.min(1), observedAt: ISO }).strict();

// --- construtores de regras ----------------------------------------------------------------------------------------------------------------------------------------------------------
export const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a !== null && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);
const len = (v: unknown) => (typeof v === "string" ? v.trim().length : Array.isArray(v) ? v.length : v !== null && typeof v === "object" ? Object.keys(v).length : 0);
export const present = (id: string, path: string, message: string, severity: RuleSpec["severity"] = "block_generation"): RuleSpec => ({ id, layer: "required", severity, path, message, check: (d) => { const v = get(d, path); return { passed: v !== undefined && v !== null && len(v) !== 0 && v !== "", evidence: { present: v !== undefined } }; } });
export const minCount = (id: string, path: string, n: number, message: string, severity: RuleSpec["severity"] = "block_indexing"): RuleSpec => ({ id, layer: "required", severity, path, message, check: (d) => { const v = get(d, path); const c = Array.isArray(v) ? v.length : 0; return { passed: c >= n, evidence: { count: c, min: n } }; } });
/** Toda métrica do caminho precisa de FONTE e data de verificação (valor sem proveniência não vale). */
export const sourcedMetrics = (id: string, path: string, severity: RuleSpec["severity"] = "block_indexing"): RuleSpec => ({ id, layer: "provenance", severity, path, message: `Cada métrica de ${path} precisa de fonte e data de verificação (valor sem proveniência não conta)`, check: (d) => {
  const v = get(d, path); const arr = Array.isArray(v) ? (v as Record<string, unknown>[]) : []; const bad = arr.filter((m) => !m.source || !m.verifiedAt).map((m) => String(m.id ?? "?"));
  return { passed: bad.length === 0, evidence: { withoutProvenance: bad, total: arr.length } };
} });
/** Validade: valor com `validUntil` vencido não é verificável. */
export const notExpired = (id: string, path: string): RuleSpec => ({ id, layer: "quality", severity: "warning", path, message: `Há métricas vencidas em ${path}`, check: (d, c) => { const arr = (get(d, path) as Record<string, unknown>[] | undefined) ?? []; const exp = arr.filter((m) => typeof m.validUntil === "string" && new Date(m.validUntil) < c.now).map((m) => String(m.id)); return { passed: exp.length === 0, evidence: { expired: exp } }; } });
/** R3: tempo de deslocamento só com fonte de roteamento; distância não é tempo. */
export const noTravelTimeWithoutRouting = (id: string, path: string): RuleSpec => ({ id, layer: "quality", severity: "block_generation", path, message: "Tempo de deslocamento exige fonte de roteamento (distância não é tempo)", check: (d) => { const arr = (get(d, path) as Record<string, unknown>[] | undefined) ?? []; const bad = arr.filter((s) => s.walkMinutes !== undefined && !s.routingSource).map((s) => String(s.name)); return { passed: bad.length === 0, evidence: { withoutRouting: bad } }; } });
export const noInventedOffers = (id: string): RuleSpec => ({ id, layer: "quality", severity: "block_indexing", path: "offers", message: "Ofertas só com preço, moeda, fonte e data de observação", check: (d) => { const arr = (get(d, "offers") as Record<string, unknown>[] | undefined) ?? []; const bad = arr.filter((o) => !o.source || !o.observedAt || !o.priceCurrency); return { passed: bad.length === 0, evidence: { invalid: bad.length } }; } });

// --- sinais de densidade -----------------------------------------------------------------------------------------------------------------------------------------------------------
export const signalCount = (id: string, weight: number, path: string, min: number, description: string): DensitySignal => ({ id, weight, description, test: (d) => { const v = get(d, path); const c = Array.isArray(v) ? v.length : 0; return { ok: c >= min, detail: `${c} de ${min} necessário(s) em ${path}` }; } });
export const signalChars = (id: string, weight: number, path: string, min: number, description: string): DensitySignal => ({ id, weight, description, test: (d) => { const c = len(get(d, path)); return { ok: c >= min, detail: `${c} de ${min} caracteres em ${path}` }; } });
/** Total de itens somando todas as chaves de um objeto de listas (ex.: amenities por categoria). */
export const signalObjectTotal = (id: string, weight: number, path: string, min: number, description: string): DensitySignal => ({ id, weight, description, test: (d) => { const o = get(d, path); const c = o && typeof o === "object" ? Object.values(o as Record<string, unknown>).reduce<number>((s, a) => s + (Array.isArray(a) ? a.length : 0), 0) : 0; return { ok: c >= min, detail: `${c} de ${min} item(ns) em ${path}` }; } });
