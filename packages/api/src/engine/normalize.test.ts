import { describe, expect, it } from "vitest";
import { fold, jaccard, normalizeQuery, tokens } from "./normalize";

describe("normalização de queries", () => {
  it("sem acento, minúsculas, sem pontuação e sem palavras vazias", () => {
    expect(fold("São José DO Rio Preto")).toBe("sao jose do rio preto");
    expect(tokens("Apartamentos à venda, em São Paulo!")).toEqual(["apartamento", "venda", "sao", "paulo"]);
    expect(normalizeQuery("  Comprar   CASA em  Campinas?? ")).toBe("comprar casa campina"); // o mesmo plural simples vale para o índice de entidades
  });
  it("plural simples sem estragar palavras curtas ou terminadas em ss/is", () => {
    expect(tokens("sois gás")).toEqual(["sois", "gas"]); // curtas ou terminadas em is/us/ss ficam
    expect(tokens("apartamentos plantas casas")).toEqual(["apartamento", "planta", "casa"]);
    expect(tokens("mais ônibus classe")).toEqual(["mais", "onibus", "classe"]);
  });
  it("sinônimos opcionais da vertical aplicam-se depois da normalização", () => {
    expect(tokens("apto à venda", { apto: "apartamento" })).toEqual(["apartamento", "venda"]);
  });
  it("entradas vazias, só pontuação ou só palavras vazias dão lista vazia (sem erro)", () => {
    for (const s of ["", "   ", "!!!", "de a o em"]) expect(tokens(s)).toEqual([]);
  });
  it("jaccard: 1 para iguais, 0 para disjuntos, 0 para dois vazios, simétrico", () => {
    expect(jaccard(["a", "b"], ["b", "a"])).toBe(1);
    expect(jaccard(["a"], ["b"])).toBe(0);
    expect(jaccard([], [])).toBe(0);
    expect(jaccard(["a", "b", "c"], ["b", "c", "d"])).toBeCloseTo(0.5, 9);
    expect(jaccard(["a", "b"], ["b", "c"])).toBe(jaccard(["b", "c"], ["a", "b"]));
  });
});
