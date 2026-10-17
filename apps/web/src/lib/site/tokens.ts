import type { CSSProperties } from "react";

// Tokens do SITE publicado (ADR-040): separados dos tokens do produto (Menlo AIB). Fonte única; o contraste é conferido por teste.
export const SITE_TOKENS = {
  bg: "#ffffff",
  surface: "#f6f7f9",
  fg: "#14161c",
  muted: "#4a5160",
  line: "#dfe3ea",
  accent: "#1f3fbf",
} as const;

/** Pares texto/fundo usados pelos blocos; cada um precisa de pelo menos 4,5:1 (WCAG 2.1 AA, texto normal). */
export const SITE_TEXT_PAIRS: readonly (readonly [keyof typeof SITE_TOKENS, keyof typeof SITE_TOKENS])[] = [
  ["fg", "bg"], ["muted", "bg"], ["accent", "bg"], ["fg", "surface"], ["muted", "surface"], ["accent", "surface"],
];

export const siteStyle = Object.fromEntries(Object.entries(SITE_TOKENS).map(([k, v]) => [`--site-${k}`, v])) as CSSProperties;
