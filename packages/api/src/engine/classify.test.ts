import { describe, expect, it } from "vitest";
import { MATCH_THRESHOLD, classifyQuery, clusterKey, clusterQueries } from "./classify";
import { buildEntityIndex, extractEntities, type EntityRecord } from "./entities";
import { validateVertical } from "./vertical";
import { TEST_VERTICAL as V } from "./test-support/vertical.fixture";

const city = (id: string, name: string, uf: string): EntityRecord => ({ kind: "city", id, name, qualifier: uf });
const ENTITIES = [city("c1", "Campinas", "SP"), city("c2", "São Paulo", "SP"), city("c3", "Rio de Janeiro", "RJ"), city("c4", "Rio Branco", "AC"), city("c5", "Rio", "XX"), city("h1", "Santa Rita", "PB"), city("h2", "Santa Rita", "MA")];
const IDX = buildEntityIndex(ENTITIES);

describe("a vertical de teste é válida (e o validador acusa os defeitos)", () => {
  it("sem problemas", () => expect(validateVertical(V)).toEqual([]));
  it("acusa padrão com intenção desconhecida, modelo sem {entity}, requisito inexistente e ids duplicados", () => {
    const bad = { ...V, patterns: [...V.patterns, { ...V.patterns[0]!, key: "x", intent: "nao-existe", templates: ["sem slot"], requiredEvidence: ["nada"] }, { ...V.patterns[1]! }] };
    const errors = validateVertical(bad).join("\n");
    expect(errors).toContain("intenção desconhecida");
    expect(errors).toContain("exatamente um {entity}");
    expect(errors).toContain("requisito de evidência desconhecido");
    expect(errors).toContain("padrão duplicado");
  });
  it("acusa pesos fora de 0..1, campo desconhecido em modelo e sinal sem grupo existente", () => {
    const bad = { ...V, intents: [{ ...V.intents[0]!, commercialWeight: 2 }, ...V.intents.slice(1)], signals: [{ ...V.signals[0]!, groups: ["inexistente"] }], patterns: [{ ...V.patterns[0]!, templates: ["comprar {cidade}"] }, ...V.patterns.slice(1)] };
    const errors = validateVertical(bad).join("\n");
    expect(errors).toContain("pesos fora de 0..1");
    expect(errors).toContain("grupo sem padrões");
    expect(errors).toContain("campo desconhecido");
  });
});

describe("resolução de entidades: só entidades reais, sem adivinhar", () => {
  it("acha a cidade sem acento e sem diferenciar maiúsculas; o resto vira resíduo", () => {
    const ex = extractEntities(IDX, "COMPRAR plantas em sao paulo");
    expect(ex.resolved.map((m) => m.record.id)).toEqual(["c2"]);
    expect(ex.residual).toEqual(["comprar", "planta"]);
  });
  it("prefere o nome mais longo: 'Rio de Janeiro' vence 'Rio'", () => {
    expect(extractEntities(IDX, "plantas em Rio de Janeiro").resolved.map((m) => m.record.id)).toEqual(["c3"]);
    expect(extractEntities(IDX, "plantas em Rio Branco").resolved.map((m) => m.record.id)).toEqual(["c4"]);
  });
  it("homônimos: sem qualificador é ambíguo (nenhuma é escolhida); com a UF, resolve", () => {
    const amb = extractEntities(IDX, "plantas em Santa Rita");
    expect(amb.resolved).toEqual([]);
    expect(amb.ambiguous[0]!.candidates.map((c) => c.id).sort()).toEqual(["h1", "h2"]);
    const ok = extractEntities(IDX, "plantas em Santa Rita PB");
    expect(ok.resolved.map((m) => m.record.id)).toEqual(["h1"]);
    expect(ok.residual).toEqual(["planta"]); // a UF é consumida junto
  });
  it("entidade inexistente: nada resolvido; a query inteira é resíduo", () => {
    const ex = extractEntities(IDX, "plantas em Atlântida");
    expect(ex.resolved).toEqual([]);
    expect(ex.residual).toEqual(["planta", "atlantida"]);
  });
  it("índice vazio ou query vazia não dão erro", () => {
    expect(extractEntities(buildEntityIndex([]), "plantas em Campinas").resolved).toEqual([]);
    expect(extractEntities(IDX, "").resolved).toEqual([]);
  });
});

describe("classificação de queries: padrão da vertical + entidade", () => {
  const ok = (q: string) => { const c = classifyQuery(V, IDX, q); if (c.status !== "matched") throw new Error(`${q}: ${c.status} ${"reason" in c ? c.reason : ""}`); return c; };
  it("variações da MESMA intenção chegam ao mesmo padrão e à mesma entidade", () => {
    for (const q of ["comprar plantas em Campinas", "Plantas à venda em campinas", "loja de plantas em CAMPINAS", "comprar planta Campinas"]) { const c = ok(q); expect(c.pattern.key, q).toBe("buy-plants"); expect(c.entity!.id).toBe("c1"); }
  });
  it("intenções diferentes NÃO se misturam, mesmo com palavras parecidas", () => {
    expect(ok("melhor loja de plantas em Campinas").pattern.key).toBe("compare-stores");
    expect(ok("loja de plantas em Campinas").pattern.key).toBe("buy-plants");
    expect(ok("comprar vasos em Campinas").pattern.key).toBe("buy-pots"); // mesma intenção, outro padrão: não funde
  });
  it("query sem entidade casa só com padrões sem entidade; query com entidade não casa com eles", () => {
    expect(ok("como cuidar de samambaia").entity).toBeNull();
    expect(classifyQuery(V, IDX, "como cuidar de samambaia em Campinas").status).not.toBe("matched");
  });
  it("sem padrão parecido: 'unmatched' com o motivo (nunca forçada num cluster)", () => {
    const c = classifyQuery(V, IDX, "aluguel de carros em Campinas");
    expect(c).toMatchObject({ status: "unmatched" });
    expect((c as { reason: string }).reason).toContain("nenhum padrão");
  });
  it("homônimo sem qualificador e query com duas cidades: ambíguas, não escolhidas", () => {
    expect(classifyQuery(V, IDX, "comprar plantas em Santa Rita").status).toBe("ambiguous");
    expect(classifyQuery(V, IDX, "comprar plantas em Campinas e São Paulo").status).toBe("ambiguous");
    expect(classifyQuery(V, IDX, "comprar plantas em Santa Rita MA")).toMatchObject({ status: "matched", entity: { id: "h2" } });
  });
  it("o limiar de aproximação é explícito", () => expect(MATCH_THRESHOLD).toBe(0.6));
});

describe("agrupamento de queries equivalentes (critério 3)", () => {
  const queries = [
    "comprar plantas em Campinas", "Plantas à venda em Campinas", "loja de plantas em campinas", "comprar plantas em campinas",
    "comprar plantas em São Paulo", "melhor loja de plantas em Campinas", "melhores lojas de plantas em Campinas", "comprar vasos em Campinas",
    "como cuidar de samambaia", "cuidados com samambaia", "aluguel de carros em Campinas", "plantas em Santa Rita",
  ];
  const { clusters, unclassified } = clusterQueries(V, IDX, queries);
  it("queries equivalentes viram UM cluster por padrão e entidade, com as variações e sem duplicar a idêntica", () => {
    const c = clusters.find((x) => x.key === clusterKey(V.patterns[0]!, ENTITIES[0]!))!;
    expect(c.members.map((m) => m.normalized).sort()).toEqual(["comprar planta campina", "loja planta campina", "planta venda campina"]);
    expect(c.members.find((m) => m.normalized === "comprar planta campina")!.count).toBe(2);
  });
  it("a mesma intenção em entidades diferentes são clusters diferentes", () => {
    const keys = clusters.map((c) => c.key);
    expect(keys).toContain("buy-plants:transactional:city:c1");
    expect(keys).toContain("buy-plants:transactional:city:c2");
  });
  it("intenções incompatíveis nunca compartilham cluster", () => {
    for (const c of clusters) expect(new Set(c.members.map((m) => classifyQuery(V, IDX, m.text)).map((x) => (x.status === "matched" ? x.pattern.intent : "?"))).size).toBe(1);
    const intentsPerEntityPattern = new Map<string, Set<string>>();
    for (const c of clusters) intentsPerEntityPattern.set(c.key, new Set([c.pattern.intent]));
    expect([...intentsPerEntityPattern.values()].every((s) => s.size === 1)).toBe(true);
    expect(clusters.find((c) => c.key.startsWith("compare-stores"))!.members).toHaveLength(2);
  });
  it("o que não casa fica FORA dos clusters, com o motivo", () => {
    expect(unclassified.map((u) => u.text).sort()).toEqual(["aluguel de carros em Campinas", "plantas em Santa Rita"].sort());
    expect(unclassified.every((u) => u.reason.length > 0)).toBe(true);
    expect(clusters.flatMap((c) => c.members).length + unclassified.length).toBeGreaterThanOrEqual(queries.length - 1); // 100% classificadas ou explicadas (a repetida colapsa)
  });
  it("determinístico e independente da ordem de entrada", () => {
    const a = clusterQueries(V, IDX, queries).clusters.map((c) => c.key);
    const b = clusterQueries(V, IDX, [...queries].reverse()).clusters.map((c) => c.key);
    expect(a).toEqual(b);
  });
});

describe("margem entre intenções diferentes", () => {
  const mk = (templates: [string, string]): typeof V => ({ ...V, patterns: [
    { ...V.patterns[3]!, key: "lease-a", intent: "transactional", entityKind: null, templates: [templates[0]] },
    { ...V.patterns[3]!, key: "lease-b", intent: "informational", entityKind: null, templates: [templates[1]] },
  ] });
  it("dois padrões de INTENÇÕES diferentes com a mesma proximidade: ambígua, nunca escolhida (empate não vira cluster)", () => {
    const v = mk(["samambaia grande barata vaso cuidar", "samambaia grande barata vaso adubar"]);
    const r = classifyQuery(v, IDX, "samambaia grande barata vaso");
    expect(r.status).toBe("ambiguous");
  });
  it("o mesmo empate com a MESMA intenção não é ambíguo (são variações do mesmo cluster)", () => {
    const base = mk(["samambaia grande barata vaso cuidar", "samambaia grande barata vaso adubar"]);
    const v = { ...base, patterns: [base.patterns[0]!, { ...base.patterns[1]!, intent: "transactional" }] };
    expect(classifyQuery(v, IDX, "samambaia grande barata vaso").status).toBe("matched");
  });
});
describe("plural: palavras terminadas em 'ss' não perdem o 's'", () => {
  it("'business' e 'stress' ficam inteiras; 'casas' vira 'casa'", async () => {
    const { tokens } = await import("./normalize");
    expect(tokens("business stress casas")).toEqual(["business", "stress", "casa"]);
  });
});

describe("escopos da vertical", () => {
  const withScopes = (scopes: NonNullable<typeof V.scopes>) => validateVertical({ ...V, scopes }).join("\n");
  it("escopo válido passa", () => expect(validateVertical({ ...V, scopes: [{ id: "piloto-a", label: "A", entityKind: V.entityKinds[0]!, entityCodes: ["1", "2"] }] })).toEqual([]));
  it("id repetido, tipo desconhecido e códigos vazios ou repetidos são recusados", () => {
    const k = V.entityKinds[0]!;
    expect(withScopes([{ id: "a1", label: "", entityKind: k, entityCodes: ["1"] }, { id: "a1", label: "", entityKind: k, entityCodes: ["1"] }])).toContain("escopo duplicado");
    expect(withScopes([{ id: "a1", label: "", entityKind: "inexistente", entityCodes: ["1"] }])).toContain("tipo de entidade desconhecido");
    expect(withScopes([{ id: "a1", label: "", entityKind: k, entityCodes: [] }])).toContain("vazios ou repetidos");
    expect(withScopes([{ id: "a1", label: "", entityKind: k, entityCodes: ["1", "1"] }])).toContain("vazios ou repetidos");
    expect(withScopes([{ id: "A!", label: "", entityKind: k, entityCodes: ["1"] }])).toContain("id inválido");
  });
});
