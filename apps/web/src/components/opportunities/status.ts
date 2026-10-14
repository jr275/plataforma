import { engine, type engine as E } from "@plataforma/api";
import type { Tone } from "@/components/ui/badge";

// Só para componentes de SERVIDOR: depende do motor (nunca importar em componente de cliente; arrastaria o driver do banco para o navegador).
export const STATUS_TONE: Partial<Record<E.LifecycleState, Tone>> = {
  discovered: "outline", validated: "neutral", scored: "info", eligible: "brand", rejected: "danger", retired: "outline", published: "success", measured: "success", learned: "success",
};
export const statusTone = (s: E.LifecycleState): Tone => STATUS_TONE[s] ?? "info";
export const statusLabel = (s: E.LifecycleState): string => engine.STATE_LABEL[s];

