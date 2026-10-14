import type { Validation } from "@plataforma/api/src/draft";
import type { GateReport } from "@plataforma/api/src/engine/experience-gates";

/** Avaliação do servidor para o cliente (validação do rascunho + resultado dos seis gates sobre ele). Serializável. */
export interface DraftEvaluationDTO { readonly validation: Validation; readonly gates: GateReport }
export type ActionResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly kind: "conflict" | "invalid" | "no_blueprint" | "not_found" | "auth" | "error"; readonly message: string };
