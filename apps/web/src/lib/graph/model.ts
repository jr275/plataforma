// Modelo de domínio do Knowledge Graph. Independente de qualquer biblioteca de renderização ou layout:
// o explorador visual consome estes tipos, e uma API real (packages/api) pode produzi-los no lugar do adaptador demonstrativo.

export const NODE_KINDS = ["entity", "organization", "place", "topic", "page", "fact", "source"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const VERIFICATIONS = ["verified", "inferred", "unverified", "expired"] as const;
export type Verification = (typeof VERIFICATIONS)[number];

export const PROVENANCES = ["source", "inference", "curation"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const RELATION_TYPES = ["supplies", "serves", "applies", "part_of", "governed_by", "located_in", "varies_by", "relates_to", "about", "evidenced_by", "covers", "cites"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export type HistoryEntry = { when: string; actor: string; text: string };

export type GraphNode = {
  id: string;
  kind: NodeKind;
  label: string;
  summary: string;
  verification: Verification;
  provenance: Provenance;
  /** Texto relativo de verificação, como vem da fonte ("há 2 dias"). */
  verifiedAt?: string;
  validUntil?: string;
  freshness?: string;
  attributes: readonly { label: string; value: string }[];
  history: readonly HistoryEntry[];
  /** Nó gerado só para demonstrar o estado de grafo denso. */
  synthetic?: boolean;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  verification: Verification;
  provenance: Provenance;
  /** Ids de nós `fact` que sustentam a relação. */
  evidenceIds: readonly string[];
};

export type KnowledgeGraph = {
  tenantId: string;
  tenantName: string;
  /** Sempre `true` enquanto o grafo vier do adaptador demonstrativo. */
  isDemo: boolean;
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
};

export const KIND_META: Record<NodeKind, { label: string; plural: string; layer: "domain" | "evidence" | "output" }> = {
  entity: { label: "Entidade", plural: "Entidades", layer: "domain" },
  organization: { label: "Organização", plural: "Organizações", layer: "domain" },
  place: { label: "Lugar", plural: "Lugares", layer: "domain" },
  topic: { label: "Tópico", plural: "Tópicos", layer: "domain" },
  page: { label: "Página", plural: "Páginas", layer: "output" },
  fact: { label: "Fato", plural: "Fatos", layer: "evidence" },
  source: { label: "Fonte", plural: "Fontes", layer: "evidence" },
};

export const RELATION_META: Record<RelationType, { label: string }> = {
  supplies: { label: "fornece" },
  serves: { label: "atende" },
  applies: { label: "aplica" },
  part_of: { label: "compõe" },
  governed_by: { label: "regido por" },
  located_in: { label: "localizado em" },
  varies_by: { label: "varia por" },
  relates_to: { label: "relaciona-se com" },
  about: { label: "afirma sobre" },
  evidenced_by: { label: "evidenciado por" },
  covers: { label: "aborda" },
  cites: { label: "cita" },
};

export const VERIFICATION_META: Record<Verification, { label: string; tone: "success" | "info" | "warning" | "danger" }> = {
  verified: { label: "Verificado", tone: "success" },
  inferred: { label: "Inferido", tone: "info" },
  unverified: { label: "Não verificado", tone: "warning" },
  expired: { label: "Expirado", tone: "danger" },
};

export const PROVENANCE_META: Record<Provenance, { label: string }> = {
  source: { label: "Extraído de fonte" },
  inference: { label: "Inferência do sistema" },
  curation: { label: "Curadoria humana" },
};
