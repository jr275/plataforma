import { ImageResponse } from "next/og";

// Imagem Open Graph de uma página gerada (Vercel OG / next/og, "dynamic title"): título e cidade vêm da versão exibida. Esta imagem é só
// uma PRÉVIA autenticada: não é guardada nem publicada. Satori exige `display: flex` em todo contêiner com mais de um filho.
export const OG_SIZE = { width: 1200, height: 630 } as const;

export interface PageOgModel { readonly title: string; readonly city: string; readonly uf: string; readonly path: string; readonly status: "draft" | "blocked"; readonly template: string; readonly version: number }

/** Limita o título para caber em até 3 linhas (sem cortar no meio de uma palavra quando dá). */
export function ogTitle(raw: string, max = 96): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

export function pageOgResponse(m: PageOgModel): ImageResponse {
  const blocked = m.status === "blocked";
  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 64, color: "#eef0ff", background: "linear-gradient(135deg, #12132b 0%, #181a3a 55%, #1f47ff 160%)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 4, color: "#9aa0c8" }}>{`${m.city}, ${m.uf}`.toUpperCase()}</div>
          <div style={{ display: "flex", fontSize: 22, padding: "8px 18px", borderRadius: 999, border: `2px solid ${blocked ? "#ff8a3d" : "#00e5ff"}`, color: blocked ? "#ff8a3d" : "#00e5ff" }}>{blocked ? "BLOQUEADA" : "RASCUNHO · NÃO PUBLICADA"}</div>
        </div>
        <div style={{ display: "flex", fontSize: 68, lineHeight: 1.1, fontWeight: 700, letterSpacing: -1 }}>{ogTitle(m.title)}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", height: 8, width: 360, borderRadius: 8, background: "linear-gradient(90deg, #00e5ff, #1f47ff, #7b1fff)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#9aa0c8" }}>
            <div style={{ display: "flex" }}>{m.path}</div>
            <div style={{ display: "flex" }}>{`${m.template} · versão ${m.version}`}</div>
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, headers: { "Cache-Control": "private, no-store" } },
  );
}
