// Entidade, identificador e catálogo de tipos/relações (ADR-021). O núcleo é genérico: Property, Listing etc. são REGISTRADOS por
// um catálogo de domínio (pack), não nomeados aqui (regra 10).

export interface EntityIdentifier { readonly scheme: string; readonly value: string }
export interface Entity { readonly id: string; readonly tenantId: string; readonly kind: string; readonly identifiers: readonly EntityIdentifier[] }

export type Cardinality = "one_to_one" | "one_to_many" | "many_to_one" | "many_to_many";
export interface EntityKindDefinition { readonly kind: string; readonly identifierSchemes: readonly string[] }
export interface RelationTypeDefinition {
  readonly type: string;
  readonly from: readonly string[];
  readonly to: readonly string[];
  readonly cardinality: Cardinality;
  /** A relação tem tempo de validade? */
  readonly temporal: boolean;
}
export interface Relation { readonly id: string; readonly tenantId: string; readonly type: string; readonly fromId: string; readonly toId: string }

export interface DomainCatalog { readonly kinds: readonly EntityKindDefinition[]; readonly relations: readonly RelationTypeDefinition[] }

export function validateCatalog(c: DomainCatalog): string[] {
  const e: string[] = [];
  const kinds = new Set<string>();
  for (const k of c.kinds) { if (kinds.has(k.kind)) e.push(`tipo de entidade duplicado: ${k.kind}`); kinds.add(k.kind); }
  const types = new Set<string>();
  for (const r of c.relations) {
    if (types.has(r.type)) e.push(`tipo de relação duplicado: ${r.type}`); types.add(r.type);
    if (r.from.length === 0 || r.to.length === 0) e.push(`relação ${r.type}: precisa de tipos de origem e de destino`);
    for (const k of [...r.from, ...r.to]) if (!kinds.has(k)) e.push(`relação ${r.type}: tipo de entidade desconhecido "${k}"`);
  }
  return e;
}

/** Valida uma entidade contra o catálogo: tipo registrado, esquemas de identificador permitidos e sem identificador repetido. */
export function validateEntity(c: DomainCatalog, en: Entity): string[] {
  const e: string[] = [];
  const def = c.kinds.find((k) => k.kind === en.kind);
  if (!en.id.trim() || !en.tenantId.trim()) e.push("id e tenantId são obrigatórios");
  if (!def) return [...e, `tipo de entidade não registrado: ${en.kind}`];
  const seen = new Set<string>();
  for (const i of en.identifiers) {
    if (!def.identifierSchemes.includes(i.scheme)) e.push(`esquema de identificador não permitido para ${en.kind}: ${i.scheme}`);
    if (!i.value.trim()) e.push(`identificador vazio (${i.scheme})`);
    const key = `${i.scheme}\u0000${i.value}`;
    if (seen.has(key)) e.push(`identificador repetido: ${i.scheme}=${i.value}`);
    seen.add(key);
  }
  return e;
}

/** A relação respeita os tipos e o tenant das duas pontas? (Cardinalidade se confere contra o conjunto existente, na persistência.) */
export function validateRelation(c: DomainCatalog, rel: Relation, from: Entity, to: Entity): string[] {
  const e: string[] = [];
  const def = c.relations.find((r) => r.type === rel.type);
  if (!def) return [`tipo de relação não registrado: ${rel.type}`];
  if (rel.fromId === rel.toId) e.push("relação de uma entidade com ela mesma não é permitida");
  if (from.id !== rel.fromId || to.id !== rel.toId) e.push("as entidades informadas não correspondem às pontas da relação");
  if (!def.from.includes(from.kind)) e.push(`${rel.type} não parte de ${from.kind}`);
  if (!def.to.includes(to.kind)) e.push(`${rel.type} não chega a ${to.kind}`);
  if (from.tenantId !== rel.tenantId || to.tenantId !== rel.tenantId) e.push("as pontas e a relação precisam ser do mesmo tenant");
  return e;
}
