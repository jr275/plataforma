import type { graph } from "@plataforma/api";
import type { Tone } from "@/components/ui/badge";

export const KIND_LABEL: Record<graph.GraphNodeKind, string> = { city: "Cidade", uf: "UF", region: "Região", page: "Página" };
export const KIND_PLURAL: Record<graph.GraphNodeKind, string> = { city: "Cidades", uf: "UFs", region: "Regiões", page: "Páginas" };
export const KIND_TONE: Record<graph.GraphNodeKind, Tone> = { city: "neutral", uf: "info", region: "brand", page: "warning" };
export const BASIS_LABEL: Record<graph.Basis | "suggestion", { label: string; tone: Tone; help: string }> = {
  fact: { label: "Fato da fonte", tone: "success", help: "Valor literal do arquivo importado." },
  derived: { label: "Derivado", tone: "info", help: "Calculado ou gravado pelo sistema a partir de fatos." },
  suggestion: { label: "Sugestão", tone: "warning", help: "Ação possível. Não é um fato." },
};
export const EDGE_BASIS_LABEL: Record<graph.EdgeBasis, string> = { source_column: "coluna da fonte", recorded_link: "vínculo gravado" };

export type SourceVerification = { label: string; tone: Tone };
/** Estado de verificação da origem: só `real` + execução concluída é dito verificado; teste e manual nunca se passam por dado real. */
export function verificationOf(s: Pick<graph.GraphSource, "origin" | "status">): SourceVerification {
  if (s.origin !== "real") return { label: s.origin === "test" ? "Origem de teste: não representa dado real" : "Origem manual: sem verificação automática", tone: "warning" };
  if (s.status === "succeeded") return { label: "Origem real · execução concluída", tone: "success" };
  if (s.status === "partial") return { label: "Origem real · execução parcial (houve linhas rejeitadas)", tone: "warning" };
  if (s.status === "running") return { label: "Importação em andamento", tone: "info" };
  return { label: "Importação falhou", tone: "danger" };
}
export const ageDays = (d: Date, now: Date): number => Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
