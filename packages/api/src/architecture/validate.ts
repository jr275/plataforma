import type { ArchetypeContract, DensityProfile, Provenance, RuleResult, ValidationResult, ValidationStatus } from "./types";

// Validação em cinco camadas, SEPARADAS no resultado: (1) schema (forma), (2) dados obrigatórios, (3) qualidade, (4) proveniência, (5) elegibilidade (geração e indexação). Existir não é valer:
// métrica sem fonte reprova a camada de proveniência mesmo com o formato correto. Nada é pontuado sobre dado que nem passou no schema.
export interface ProfileOverride { readonly version: string; readonly indexingThreshold?: number; /** Substitui pesos por id de sinal; a soma final precisa dar 1. */ readonly weights?: Readonly<Record<string, number>> }
export function applyProfile(base: DensityProfile, o?: ProfileOverride): { profile: DensityProfile; errors: string[] } {
  if (!o) return { profile: base, errors: [] };
  const errors: string[] = []; const ids = new Set(base.signals.map((s) => s.id));
  for (const k of Object.keys(o.weights ?? {})) if (!ids.has(k)) errors.push(`sinal desconhecido no perfil: ${k}`);
  const signals = base.signals.map((s) => ({ ...s, weight: o.weights?.[s.id] ?? s.weight }));
  const sum = signals.reduce((a, s) => a + s.weight, 0); if (Math.abs(sum - 1) > 1e-9) errors.push(`os pesos do perfil somam ${sum}, não 1`);
  if (signals.some((s) => !(s.weight >= 0))) errors.push("peso negativo");
  const t = o.indexingThreshold ?? base.indexingThreshold; if (!(t > 0 && t <= 1)) errors.push("limiar fora de (0, 1]");
  return { profile: { version: o.version, signals, indexingThreshold: t }, errors };
}

export function validateArchetypeData(contract: ArchetypeContract, input: { readonly data: unknown; readonly provenance?: readonly Provenance[]; readonly now?: Date }, override?: ProfileOverride): ValidationResult {
  const now = input.now ?? new Date(); const issues: RuleResult[] = []; const warnings: RuleResult[] = [];
  const base = { archetypeId: contract.id, contractVersion: contract.version, evidence: input.provenance ?? [] };
  const parsed = contract.schema.safeParse(input.data);
  if (!parsed.success) {
    const schemaIssues: RuleResult[] = parsed.error.issues.map((i) => ({ id: `${contract.id}.schema`, layer: "schema" as const, severity: "block_generation" as const, passed: false, message: i.message, path: i.path.join("."), evidence: { code: i.code } }));
    const missing = parsed.error.issues.filter((i) => i.code === "invalid_type" && /undefined|required/i.test(i.message)).map((i) => i.path.join(".")).filter(Boolean);
    return { ...base, status: "INVALID", score: null, isValidForIndexing: false, isValidForGeneration: false, issues: schemaIssues, warnings, missingData: [...new Set(missing)], failedRules: [`${contract.id}.schema`], density: null };
  }
  const data = parsed.data; const results: RuleResult[] = [];
  for (const r of contract.requirements) { const c = r.check(data, { provenance: input.provenance ?? [], now }); results.push({ id: r.id, layer: r.layer, severity: r.severity, passed: c.passed, message: r.message, ...(r.path ? { path: r.path } : {}), ...(c.evidence !== undefined ? { evidence: c.evidence } : {}) }); }
  const { profile, errors } = applyProfile(contract.density, override);
  if (errors.length) throw new Error(`perfil de densidade inválido: ${errors.join("; ")}`);
  const sig = profile.signals.map((s) => { const t = s.test(data); return { id: s.id, weight: s.weight, ok: t.ok, detail: t.detail }; });
  const score = Number(sig.reduce((a, s) => a + (s.ok ? s.weight : 0), 0).toFixed(4));
  const densityOk = score >= profile.indexingThreshold;
  results.push({ id: `${contract.id}.density`, layer: "eligibility", severity: "block_indexing", passed: densityOk, message: `Densidade ${score} (mínimo ${profile.indexingThreshold}) para indexação`, evidence: { score, threshold: profile.indexingThreshold, version: profile.version } });
  for (const r of results) if (!r.passed) (r.severity === "warning" ? warnings : issues).push(r);
  const failed = [...issues, ...warnings].map((r) => r.id);
  const genBlocked = issues.some((r) => r.severity === "block_generation"); const idxBlocked = issues.some((r) => r.severity === "block_indexing");
  const missingData = [...issues.filter((r) => r.layer === "required" && r.path).map((r) => r.path!), ...sig.filter((s) => !s.ok).map((s) => `density:${s.id}`)];
  const status: ValidationStatus = genBlocked ? "INVALID" : idxBlocked ? "DATA_PENDING" : warnings.length ? "VALID_WITH_WARNINGS" : "VALID";
  return { ...base, status, score, isValidForGeneration: !genBlocked, isValidForIndexing: !genBlocked && !idxBlocked, issues, warnings, missingData: [...new Set(missingData)], failedRules: failed, density: { version: profile.version, threshold: profile.indexingThreshold, signals: sig } };
}
