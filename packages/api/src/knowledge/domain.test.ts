import { describe, expect, it } from "vitest";
import { validateCatalog, validateEntity, validateRelation, type DomainCatalog, type Entity } from "./domain";

// Catálogo SINTÉTICO de teste (o catálogo imobiliário real entra no pack, em fatia própria).
const CAT: DomainCatalog = {
  kinds: [{ kind: "thing", identifierSchemes: ["ext"] }, { kind: "offer", identifierSchemes: ["ext", "url"] }, { kind: "place", identifierSchemes: ["code"] }],
  relations: [
    { type: "REPRESENTS", from: ["offer"], to: ["thing"], cardinality: "many_to_one", temporal: true },
    { type: "LOCATED_IN", from: ["thing"], to: ["place"], cardinality: "many_to_one", temporal: true },
  ],
};
const ent = (id: string, kind: string, tenantId = "t1", identifiers: Entity["identifiers"] = []): Entity => ({ id, tenantId, kind, identifiers });

describe("catálogo de domínio", () => {
  it("válido", () => expect(validateCatalog(CAT)).toEqual([]));
  it("recusa tipo duplicado e relação para tipo desconhecido", () => {
    expect(validateCatalog({ kinds: [CAT.kinds[0]!, CAT.kinds[0]!], relations: [] }).join()).toMatch(/duplicado/);
    expect(validateCatalog({ kinds: CAT.kinds, relations: [{ type: "X", from: ["nope"], to: ["thing"], cardinality: "one_to_one", temporal: false }] }).join()).toMatch(/desconhecido/);
  });
});

describe("entidade", () => {
  it("o tipo precisa estar registrado e o esquema do identificador ser permitido", () => {
    expect(validateEntity(CAT, ent("e1", "thing", "t1", [{ scheme: "ext", value: "A1" }]))).toEqual([]);
    expect(validateEntity(CAT, ent("e1", "ghost")).join()).toMatch(/não registrado/);
    expect(validateEntity(CAT, ent("e1", "thing", "t1", [{ scheme: "url", value: "http://x" }])).join()).toMatch(/não permitido/);
  });
  it("identificador repetido ou vazio é recusado", () => {
    expect(validateEntity(CAT, ent("e1", "thing", "t1", [{ scheme: "ext", value: "A" }, { scheme: "ext", value: "A" }])).join()).toMatch(/repetido/);
    expect(validateEntity(CAT, ent("e1", "thing", "t1", [{ scheme: "ext", value: " " }])).join()).toMatch(/vazio/);
  });
});

describe("relação", () => {
  const rel = (type: string, fromId: string, toId: string, tenantId = "t1") => ({ id: "r1", tenantId, type, fromId, toId });
  it("respeita os tipos das pontas (oferta REPRESENTS coisa) e não o contrário", () => {
    expect(validateRelation(CAT, rel("REPRESENTS", "o1", "p1"), ent("o1", "offer"), ent("p1", "thing"))).toEqual([]);
    expect(validateRelation(CAT, rel("REPRESENTS", "p1", "o1"), ent("p1", "thing"), ent("o1", "offer")).join()).toMatch(/não parte de/);
  });
  it("recusa tipo não registrado, auto-relação e mistura de tenants", () => {
    expect(validateRelation(CAT, rel("SAME_AS", "a", "b"), ent("a", "thing"), ent("b", "thing")).join()).toMatch(/não registrado/);
    expect(validateRelation(CAT, rel("LOCATED_IN", "a", "a"), ent("a", "thing"), ent("a", "place")).join()).toMatch(/ela mesma/);
    expect(validateRelation(CAT, rel("LOCATED_IN", "a", "b"), ent("a", "thing"), ent("b", "place", "t2")).join()).toMatch(/mesmo tenant/);
  });
});
