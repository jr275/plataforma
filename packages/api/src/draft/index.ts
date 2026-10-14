// Entrada CLIENT-SAFE do editor de experiência de página: só código puro (sem `pg`, sem node:crypto). O navegador importa daqui, nunca de `@plataforma/api`.
export * from "./contracts";
export * from "./context";
export * from "./model";
export * from "./validate";
export * from "./convert";
export { sig, stable } from "./sig";
