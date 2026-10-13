// Superfície pública de Knowledge Engineering (ADR-021), exposta no pacote como NAMESPACE (`knowledge.BiTemporalStore` etc.) para
// não poluir nem colidir com os nomes genéricos (`interval`, `Entity`, `Query`...) do restante da API.
export * from "./temporal";
export * from "./epistemic";
export * from "./provenance";
export * from "./domain";
export * from "./store";
