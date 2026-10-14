// Contexto SERIALIZÁVEL do editor: o que o sistema realmente tem (templates do registro, requisitos da vertical, fontes implementadas, fatos e caminhos conhecidos).
// Montado no servidor a partir de dados gravados; o cliente só o lê. Nada aqui é digitado pelo usuário.
export interface TemplateCtx { readonly key: string; readonly version: number; readonly entityKind: string; readonly sections: readonly { readonly id: string; readonly label: string; readonly paragraphs: readonly { readonly requires: readonly string[] }[] }[]; readonly structuredData: readonly string[] }
export interface RequirementCtx { readonly id: string; readonly label: string; readonly weight: "critical" | "important" | "optional"; readonly satisfiedBy: readonly string[]; readonly note: string }
export interface SourceCtx { readonly id: string; readonly label: string; /** Token que satisfaz requisitos (`entities`, `indicator:<ref>`...) */ readonly token: string; readonly state: "implemented_tested" }
export interface DraftContext {
  readonly verticalId: string;
  readonly templates: readonly TemplateCtx[]; readonly requirements: readonly RequirementCtx[]; readonly sources: readonly SourceCtx[];
  /** Tokens que EXISTEM agora (`entities`, `indicator:bcb-sgs:432`...). */
  readonly available: readonly string[];
  /** Fatos conhecidos da entidade (ids como `name`, `population`). Vazio = entidade sem fatos com origem registrada. */
  readonly facts: readonly string[];
  /** Caminhos de páginas existentes no site (destinos válidos de link). */
  readonly knownPaths: readonly string[];
  readonly maxCannibalizationRisk: number; readonly cannibalizationRisk: number | null;
  readonly publicationAvailable: false;
}
