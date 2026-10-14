import "server-only";
import { engine } from "@plataforma/api";
import { realEstateVertical } from "@plataforma/pack-real-estate";

// Raiz de composição das VERTICAIS (ADR-023): o núcleo não conhece nenhum domínio; é aqui que a vertical do workspace é escolhida.
// Hoje todo workspace usa a imobiliária (a RE/MAX é o piloto). Selecionar por tenant exige a tabela de configuração de workspace (ainda inexistente).
export const activeVertical: engine.VerticalDefinition = realEstateVertical;
export const researchAdapters: readonly engine.SourceAdapter[] = [engine.bcbSgsAdapter, engine.ibgeNewsAdapter, engine.rssNewsAdapter];
/** `fetch` real do runtime do servidor (as regras de URL pública, prazo e tamanho são do adaptador). */
export const realFetch: engine.FetchLike = (url, init) => globalThis.fetch(url, init) as unknown as ReturnType<engine.FetchLike>;
export const verticalMeta = { name: activeVertical.name, language: activeVertical.language, country: activeVertical.country } as const;
