import { describe, expect, it } from "vitest";
import { CAPABILITIES, CAPABILITY_STATE_LABEL, PENDING_CAPABILITIES, type CapabilityState } from "./providers";
const BLOCKED_CAPABILITIES = PENDING_CAPABILITIES.filter((c) => c.unlocks.length > 0);
import { DIMENSIONS, DIMENSION_INFO, type DimensionId } from "./score-config";
import { deriveDimensions } from "./dimensions";
import { TEST_VERTICAL as V } from "./test-support/vertical.fixture";

describe("capacidades bloqueadas: nenhuma finge existir", () => {
  it("ids únicos; toda capacidade tem estado com rótulo e detalhe; as pendentes dizem exatamente o que falta", () => {
    expect(new Set(CAPABILITIES.map((c) => c.id)).size).toBe(CAPABILITIES.length);
    const states = Object.keys(CAPABILITY_STATE_LABEL) as CapabilityState[];
    for (const c of CAPABILITIES) { expect(states, c.id).toContain(c.state); expect(c.detail.length, c.id).toBeGreaterThan(20); }
    for (const c of PENDING_CAPABILITIES) expect(c.state, c.id).not.toBe("implemented_tested");
  });
  it("só é 'implementada e testada' o que tem adaptador real; nenhuma fonte de SERP, citação, Search Console ou conversão se declara implementada", () => {
    const ok = CAPABILITIES.filter((c) => c.state === "implemented_tested").map((c) => c.id).sort();
    expect(ok).toEqual(["bcb-sgs", "ibge-news", "ibge-sidra", "rss-news"]);
    // implementadas, mas sem resposta real de sucesso: nunca se declaram "testadas"
    expect(CAPABILITIES.filter((c) => c.state === "implemented_unverified").map((c) => c.id).sort()).toEqual(["gdelt", "overpass"]);
    // DataForSEO, Search Console e LLM: adapters prontos, mas SEM resposta real: aguardam credencial
    for (const id of ["search-demand", "serp-provider", "backlinks", "search-console", "llm-classifier"]) expect(CAPABILITIES.find((c) => c.id === id)!.state, id).toBe("awaiting_credential");
    for (const id of ["serp-provider", "ai-citations", "search-console", "conversion-data", "competitor-registry", "search-demand", "publication"]) expect(CAPABILITIES.find((c) => c.id === id)!.state, id).not.toBe("implemented_tested");
    expect(CAPABILITIES.find((c) => c.id === "search-console")!.state).toBe("awaiting_credential");
    expect(CAPABILITIES.find((c) => c.id === "ai-citations")!.state).toBe("not_implemented");
  });
  it("toda dimensão que o sistema HOJE não consegue medir é destravada por alguma capacidade (e só essas)", () => {
    // Dimensões sempre desconhecidas hoje = as que o derivador nunca preenche com os dados do tenant e da vertical.
    const pattern = V.patterns[0]!;
    const entity = { kind: "city", id: "c1", name: "Campinas", qualifier: "SP" };
    const d = deriveDimensions({ def: V, config: V.scoring, pattern, entity, available: new Set(["entities"]), evidenceByRequirement: new Map(), pages: [] });
    const unknown = DIMENSIONS.filter((id) => d[id].value === null);
    expect(unknown.length).toBeGreaterThan(0);
    const unlocked = new Set<DimensionId>(BLOCKED_CAPABILITIES.flatMap((c) => c.unlocks));
    for (const id of unknown) expect(unlocked.has(id), `${id} (${DIMENSION_INFO[id].label}) não tem capacidade que a destrave`).toBe(true);
    for (const id of unlocked) expect(unknown.includes(id), `${id} é listada como bloqueada mas o sistema já a mede`).toBe(true);
  });
});
