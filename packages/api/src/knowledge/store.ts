import { checkTransition, isEligible, type ConsumptionPolicy, type EpistemicState, type TransitionReason } from "./epistemic";
import { cloneInterval, contains, hasUnknownBound, interval, intersect, leftOf, overlaps, rightOf, sameInterval, subtract, validateInterval, type TemporalInterval } from "./temporal";

// Repositório BI-TEMPORAL DE REFERÊNCIA, em memória (ADR-021). Dois eixos independentes:
//   tempo de VALIDADE   (validTime):  quando o fato vale na realidade, [início, fim);
//   tempo de TRANSAÇÃO  (recordedAt/supersededAt): quando o sistema registrou e manteve aquela versão.
// Gravar é append-only: corrigir fecha a versão antiga no tempo de transação e reinsere as partes não afetadas; nada é apagado.
// O relógio é sempre injetado (`at`) e nunca retrocede. A Fatia 2 espelha esta semântica em SQL.

export type JsonValue = string | number | boolean | null | JsonValue[] | { readonly [k: string]: JsonValue };
export interface FactKey { readonly tenantId: string; readonly subjectId: string; readonly attribute: string }

export interface FactVersion {
  readonly id: string;
  readonly key: FactKey;
  /** Número da versão dentro da chave (cresce a cada versão inserida). */
  readonly version: number;
  readonly value: JsonValue;
  readonly state: EpistemicState;
  readonly validTime: TemporalInterval;
  readonly recordedAt: Date;
  /** `null` = versão ainda em vigor no tempo de transação. */
  readonly supersededAt: Date | null;
  readonly evidenceIds: readonly string[];
  readonly staleAfter: Date | null;
  readonly verifiedAt: Date | null;
  /** Versão de que esta nasceu (correção, parte reinserida, expiração). */
  readonly supersedes: string | null;
}

export interface AssertInput {
  readonly key: FactKey;
  readonly value: JsonValue;
  /** Só estados de afirmação direta: `OBSERVED_TRUE`, `OBSERVED_FALSE` ou `INFERRED_PROBABLE`. */
  readonly state: "OBSERVED_TRUE" | "OBSERVED_FALSE" | "INFERRED_PROBABLE";
  readonly validTime: TemporalInterval;
  readonly evidenceIds: readonly string[];
  readonly reason: TransitionReason;
  readonly staleAfter?: Date;
  readonly verifiedAt?: Date;
  /** `supersede` (padrão): o novo valor corrige o anterior. `concurrent`: outra fonte discorda; marca CONFLICTING sem sobrescrever. */
  readonly mode?: "supersede" | "concurrent";
}

export type StoreErrorCode = "tenant_mismatch" | "tx_regression" | "invalid_interval" | "unknown_bound_unsupported" | "invalid_state" | "to_absent" | "not_allowed" | "reason_mismatch" | "evidence_required" | "nothing_to_close";
export type AssertResult = { readonly ok: true; readonly changed: boolean; readonly version: FactVersion } | { readonly ok: false; readonly code: StoreErrorCode; readonly message: string };

export function stableStringify(v: JsonValue): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as { readonly [k: string]: JsonValue };
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k] as JsonValue)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

const keyOf = (k: FactKey): string => `${k.tenantId}\u0000${k.subjectId}\u0000${k.attribute}`;
const FAR_FUTURE = new Date(8.64e15);

type Row = { -readonly [K in keyof FactVersion]: FactVersion[K] };
const cloneDate = (d: Date | null): Date | null => (d === null ? null : new Date(d.getTime()));
/** Cópia defensiva na SAÍDA: datas, intervalo e valor são cópias profundas; o chamador não alcança o estado interno. */
const freeze = (r: Row): FactVersion =>
  Object.freeze({
    ...r,
    key: Object.freeze({ ...r.key }),
    value: structuredClone(r.value),
    validTime: cloneInterval(r.validTime),
    recordedAt: new Date(r.recordedAt.getTime()),
    supersededAt: cloneDate(r.supersededAt),
    evidenceIds: Object.freeze([...r.evidenceIds]),
    staleAfter: cloneDate(r.staleAfter),
    verifiedAt: cloneDate(r.verifiedAt),
  });
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join("\u0001") === [...b].sort().join("\u0001");

export interface Query { readonly validAt: Date; readonly knownAt: Date }

/** Lançado quando uma chave de outro tenant chega a um repositório vinculado a um tenant (leitura ou escrita). */
export class TenantMismatchError extends Error {
  readonly code = "TENANT_MISMATCH";
  constructor() {
    super("a chave pertence a outro tenant");
    this.name = "TenantMismatchError";
  }
}

const NOT_STALE_STATES: readonly EpistemicState[] = ["OBSERVED_TRUE", "OBSERVED_FALSE", "INFERRED_PROBABLE", "CONFLICTING"];

export class BiTemporalStore {
  private rows: Row[] = [];
  private lastTx = Number.NEGATIVE_INFINITY;
  private counters = new Map<string, number>();
  private seq = 0;
  private readonly tenantId: string;

  /** O repositório é VINCULADO a um tenant: chave de outro tenant é recusada (escrita) ou lança (leitura). Não depende só do chamador. */
  constructor(options: { readonly tenantId: string }) {
    if (typeof options.tenantId !== "string" || options.tenantId.trim() === "") throw new TypeError("tenantId é obrigatório");
    this.tenantId = options.tenantId;
  }

  private ownKey(key: FactKey): void {
    if (key.tenantId !== this.tenantId) throw new TenantMismatchError();
  }

  private insert(base: Omit<Row, "id" | "version" | "recordedAt" | "supersededAt">, at: Date): Row {
    const k = keyOf(base.key);
    const version = (this.counters.get(k) ?? 0) + 1;
    this.counters.set(k, version);
    const row: Row = { ...base, id: `fv-${++this.seq}`, version, recordedAt: new Date(at.getTime()), supersededAt: null };
    this.rows.push(row);
    return row;
  }

  private currentOverlapping(key: FactKey, validTime: TemporalInterval): Row[] {
    const k = keyOf(key);
    return this.rows
      .filter((r) => keyOf(r.key) === k && r.supersededAt === null && overlaps(r.validTime, validTime) === true)
      .sort((a, b) => (a.validTime.start.kind === "instant" && b.validTime.start.kind === "instant" ? a.validTime.start.at.getTime() - b.validTime.start.at.getTime() : 0));
  }

  private badClock(at: Date): boolean {
    return Number.isNaN(at.getTime()) || at.getTime() < this.lastTx;
  }

  assert(input: AssertInput, atIn: Date): AssertResult {
    if (input.key.tenantId !== this.tenantId) return { ok: false, code: "tenant_mismatch", message: "a chave pertence a outro tenant" };
    const at = new Date(atIn.getTime());
    if (this.badClock(at)) return { ok: false, code: "tx_regression", message: "o tempo de transação não pode retroceder nem ser inválido" };
    const validTime = cloneInterval(input.validTime);
    const errors = validateInterval(validTime);
    if (errors.length > 0) return { ok: false, code: "invalid_interval", message: errors.join("; ") };
    if (hasUnknownBound(validTime)) return { ok: false, code: "unknown_bound_unsupported", message: "o repositório de referência não grava validade com limite desconhecido (decisão da Fatia 2)" };
    if (!["OBSERVED_TRUE", "OBSERVED_FALSE", "INFERRED_PROBABLE"].includes(input.state)) return { ok: false, code: "invalid_state", message: "assert só aceita observação direta ou inferência; conflito e vencimento nascem do próprio repositório" };

    // Cópias defensivas da ENTRADA: nada do que o chamador passou fica compartilhado com o estado interno.
    const safe: AssertInput = { ...input, key: { ...input.key }, value: structuredClone(input.value), validTime, evidenceIds: [...input.evidenceIds], ...(input.staleAfter ? { staleAfter: new Date(input.staleAfter.getTime()) } : {}), ...(input.verifiedAt ? { verifiedAt: new Date(input.verifiedAt.getTime()) } : {}) };

    if ((safe.mode ?? "supersede") === "concurrent") {
      const current = this.currentOverlapping(safe.key, safe.validTime);
      const differing = current.filter((r) => stableStringify(r.value) !== stableStringify(safe.value));
      if (differing.length > 0) return this.assertConcurrent(safe, current, differing, at);
    }
    return this.applySupersede(safe, at);
  }

  /** Correção ou nova observação: o valor novo vale no intervalo dado; as partes não afetadas das versões antigas continuam como estavam. */
  private applySupersede(input: AssertInput, at: Date): AssertResult {
    const current = this.currentOverlapping(input.key, input.validTime);
    const sameStale = (a: Date | null, b: Date | undefined) => (a === null ? b === undefined : b !== undefined && a.getTime() === b.getTime());

    // Idempotência: a mesma afirmação (valor, estado, validade, evidências, prazo e verificação) não cria versão nova.
    // Mesma coisa com PRAZO diferente é um refresh: vira versão nova (o prazo anterior continua no histórico).
    const same = current.find((r) => sameInterval(r.validTime, input.validTime) && r.state === input.state && stableStringify(r.value) === stableStringify(input.value) && sameSet(r.evidenceIds, input.evidenceIds) && sameStale(r.staleAfter, input.staleAfter) && sameStale(r.verifiedAt, input.verifiedAt));
    if (same) return { ok: true, changed: false, version: freeze(same) };

    const from: EpistemicState = current[0]?.state ?? "ABSENT";
    const check = checkTransition({ from, to: input.state, reason: input.reason, evidenceIds: input.evidenceIds });
    if (!check.ok) return { ok: false, code: check.code, message: check.message };

    this.lastTx = at.getTime();
    for (const r of current) {
      r.supersededAt = new Date(at.getTime());
      for (const piece of [leftOf(r.validTime, input.validTime), rightOf(r.validTime, input.validTime)]) {
        if (piece) this.insert({ key: r.key, value: r.value, state: r.state, validTime: cloneInterval(piece), evidenceIds: r.evidenceIds, staleAfter: r.staleAfter, verifiedAt: r.verifiedAt, supersedes: r.id }, at);
      }
    }
    // Corroboração (mesmo valor e mesma validade): a versão nova SOMA as evidências, para a cadeia de prova não encolher.
    const corroborated = current.filter((r) => sameInterval(r.validTime, input.validTime) && stableStringify(r.value) === stableStringify(input.value)).flatMap((r) => r.evidenceIds);
    const evidenceIds = [...new Set([...corroborated, ...input.evidenceIds])];
    const row = this.insert({ key: input.key, value: input.value, state: input.state, validTime: input.validTime, evidenceIds, staleAfter: input.staleAfter ?? null, verifiedAt: input.verifiedAt ?? null, supersedes: current[0]?.id ?? null }, at);
    return { ok: true, changed: true, version: freeze(row) };
  }

  /**
   * Outra fonte discorda. SEGMENTA os intervalos: só o trecho em que os dois valores se sobrepõem vira CONFLICTING (um conflito que
   * começa em março não contamina janeiro e fevereiro); o que está fora da sobreposição mantém seu estado, e o trecho novo sem
   * contestação é gravado como observação normal.
   */
  private assertConcurrent(input: AssertInput, current: Row[], differing: Row[], at: Date): AssertResult {
    if (input.evidenceIds.length === 0) return { ok: false, code: "evidence_required", message: "a observação concorrente precisa citar evidência" };
    const already = current.find((r) => stableStringify(r.value) === stableStringify(input.value) && sameSet(r.evidenceIds, input.evidenceIds) && r.state === "CONFLICTING");
    if (already) return { ok: true, changed: false, version: freeze(already) };

    this.lastTx = at.getTime();
    const cuts: TemporalInterval[] = [];
    let first: Row | undefined;
    for (const r of differing) {
      const inter = intersect(r.validTime, input.validTime)!;
      r.supersededAt = new Date(at.getTime());
      for (const piece of [leftOf(r.validTime, input.validTime), rightOf(r.validTime, input.validTime)]) {
        if (piece) this.insert({ key: r.key, value: r.value, state: r.state, validTime: cloneInterval(piece), evidenceIds: r.evidenceIds, staleAfter: r.staleAfter, verifiedAt: r.verifiedAt, supersedes: r.id }, at);
      }
      this.insert({ key: r.key, value: r.value, state: "CONFLICTING", validTime: cloneInterval(inter), evidenceIds: r.evidenceIds, staleAfter: r.staleAfter, verifiedAt: r.verifiedAt, supersedes: r.id }, at);
      const mine = this.insert({ key: input.key, value: input.value, state: "CONFLICTING", validTime: cloneInterval(inter), evidenceIds: input.evidenceIds, staleAfter: input.staleAfter ?? null, verifiedAt: input.verifiedAt ?? null, supersedes: r.id }, at);
      first ??= mine;
      cuts.push(inter);
    }
    // Trecho do intervalo novo que nenhuma versão com valor diferente contesta: observação normal (corrobora ou é nova).
    for (const seg of subtract(input.validTime, cuts)) {
      const overlapsSame = this.currentOverlapping(input.key, seg).some((r) => stableStringify(r.value) === stableStringify(input.value));
      const reason = input.state === "INFERRED_PROBABLE" ? "inference" : overlapsSame ? "revalidation" : "new_observation";
      const res = this.applySupersede({ ...input, validTime: cloneInterval(seg), reason, mode: "supersede" }, at);
      if (!res.ok) return res;
    }
    return { ok: true, changed: true, version: freeze(first!) };
  }

  /**
   * Marca como `UNKNOWN_STALE` as versões em vigor cujo `staleAfter` passou, INCLUSIVE conflitos: um conflito não resolvido até o
   * prazo deixa de ser apresentável como dois valores competindo e vira "desconhecido"; as duas versões continuam no histórico.
   * Não apaga a versão anterior. Devolve as versões novas.
   */
  expireStale(atIn: Date): FactVersion[] {
    const at = new Date(atIn.getTime());
    if (this.badClock(at)) return [];
    const out: FactVersion[] = [];
    const due = this.rows.filter((r) => r.supersededAt === null && r.staleAfter !== null && r.staleAfter.getTime() <= at.getTime() && NOT_STALE_STATES.includes(r.state));
    if (due.length === 0) return out;
    this.lastTx = at.getTime();
    for (const r of due) {
      r.supersededAt = new Date(at.getTime());
      out.push(freeze(this.insert({ key: r.key, value: r.value, state: "UNKNOWN_STALE", validTime: cloneInterval(r.validTime), evidenceIds: r.evidenceIds, staleAfter: null, verifiedAt: r.verifiedAt, supersedes: r.id }, at)));
    }
    return out;
  }

  /** Encerra a vigência em `validEnd` (tombstone): fecha o tempo de validade das versões em vigor, sem declarar inexistência nem mudar o estado. */
  endValidity(key: FactKey, validEndIn: Date, evidenceIds: readonly string[], atIn: Date): { ok: true; versions: FactVersion[] } | { ok: false; code: StoreErrorCode; message: string } {
    if (key.tenantId !== this.tenantId) return { ok: false, code: "tenant_mismatch", message: "a chave pertence a outro tenant" };
    const at = new Date(atIn.getTime());
    const validEnd = new Date(validEndIn.getTime());
    if (this.badClock(at)) return { ok: false, code: "tx_regression", message: "o tempo de transação não pode retroceder nem ser inválido" };
    if (evidenceIds.length === 0) return { ok: false, code: "evidence_required", message: "encerrar a vigência exige evidência" };
    const k = keyOf(key);
    const open = this.rows.filter((r) => keyOf(r.key) === k && r.supersededAt === null && r.validTime.start.kind !== "unknown" && (r.validTime.start.kind === "unbounded" || r.validTime.start.at.getTime() < validEnd.getTime()) && (r.validTime.end.kind === "unbounded" || (r.validTime.end.kind === "instant" && r.validTime.end.at.getTime() > validEnd.getTime())));
    if (open.length === 0) return { ok: false, code: "nothing_to_close", message: "não há versão em vigor para encerrar nesse instante" };
    this.lastTx = at.getTime();
    const versions = open.map((r) => {
      r.supersededAt = new Date(at.getTime());
      return freeze(this.insert({ key: r.key, value: r.value, state: r.state, validTime: cloneInterval(interval(r.validTime.start, { kind: "instant", at: validEnd })), evidenceIds: [...r.evidenceIds, ...evidenceIds], staleAfter: r.staleAfter, verifiedAt: r.verifiedAt, supersedes: r.id }, at));
    });
    return { ok: true, versions };
  }

  /** O que o sistema SABIA em `knownAt` sobre o que VALIA em `validAt`. */
  query(key: FactKey, q: Query): FactVersion[] {
    this.ownKey(key);
    const k = keyOf(key);
    const knownAt = q.knownAt.getTime();
    return this.rows
      .filter((r) => keyOf(r.key) === k && contains(r.validTime, q.validAt) === true && r.recordedAt.getTime() <= knownAt && (r.supersededAt === null || knownAt < r.supersededAt.getTime()))
      .sort((a, b) => a.version - b.version)
      .map(freeze);
  }

  /** Estado epistemológico no ponto `(validAt, knownAt)`: `ABSENT` quando nada foi registrado (não implica falsidade). */
  stateAt(key: FactKey, q: Query): EpistemicState {
    const found = this.query(key, q);
    if (found.length === 0) return "ABSENT";
    return found.some((f) => f.state === "CONFLICTING") ? "CONFLICTING" : found[0]!.state;
  }

  /** Visão atual do conhecimento (tudo o que está em vigor no tempo de transação) sobre o que vale em `validAt`. */
  current(key: FactKey, validAt: Date): FactVersion[] {
    return this.query(key, { validAt, knownAt: FAR_FUTURE });
  }

  /** Histórico completo da chave, inclusive versões já substituídas (nada é apagado). */
  history(key: FactKey): FactVersion[] {
    this.ownKey(key);
    const k = keyOf(key);
    return this.rows.filter((r) => keyOf(r.key) === k).sort((a, b) => a.version - b.version).map(freeze);
  }
}

/** Filtra versões pelo que a política de consumo permite apresentar (conflito, vencido, inferido e ausente podem ser recusados). */
export const eligibleVersions = (versions: readonly FactVersion[], policy: ConsumptionPolicy): FactVersion[] => versions.filter((v) => isEligible(v.state, policy));
