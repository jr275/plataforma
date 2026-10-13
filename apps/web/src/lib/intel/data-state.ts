// Vocabulário único de "estado do dado". Toda tela usa estes rótulos para dizer de onde vem cada valor.
import type { Tone } from "@/components/ui/badge";

export type DataState = "live" | "demo" | "derived" | "estimated" | "unavailable" | "blocked" | "not_evaluated";

export const dataStateMeta: Record<DataState, { label: string; tone: Tone; help: string }> = {
  live: { label: "Conectado", tone: "success", help: "Lido de uma integração conectada." },
  demo: { label: "Demo", tone: "brand", help: "Registro do dataset demonstrativo Exemplo Labs. Não é medição real." },
  derived: { label: "Derivado", tone: "info", help: "Calculado a partir de outros registros do dataset ativo." },
  estimated: { label: "Estimado", tone: "warning", help: "Estimativa ou inferência: não foi observado." },
  unavailable: { label: "Indisponível", tone: "outline", help: "Não existe fonte conectada para este valor." },
  blocked: { label: "Bloqueado", tone: "danger", help: "Depende de uma etapa ou fonte que falhou." },
  not_evaluated: { label: "Não avaliado", tone: "neutral", help: "A verificação ainda não foi executada." },
};
