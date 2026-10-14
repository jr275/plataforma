import { topicId, normalizeDimensions } from "../topics/generate";
import type { CombinationFamily, CombinationPolicy, CompatibilityRule, Dims, Kept, LogEntry, Space, ExpansionResult, DemandInfo } from "./types";

// Expansão controlada em LARGURA, um nível de dimensão por vez. Cada candidato passa pelos filtros em ordem (baratos primeiro) e PARA no primeiro que falhar:
//   F1 compatibilidade semântica → F2 entidade/geografia → F3 profundidade → F4 suficiência de dados → F5 redundância com o pai → F6 demanda (marca hipótese) → F7 canibalização.
// Todo candidato (mantido, podado, duplicado ou cortado pelo teto) gera uma linha de log com filtro e motivo. Determinístico: a ordem de entrada não muda o resultado.
export interface ExpandInput {
  readonly tenantId: string; readonly family: CombinationFamily; readonly roots: readonly { readonly topicId: string; readonly dimensions: Dims }[];
  readonly rules: readonly CompatibilityRule[]; readonly space: Space; readonly policy: CombinationPolicy;
  /** Tópicos já existentes: chave de intenção → topic_id (o existente vence a disputa). */ readonly existingIntents: ReadonlyMap<string, string>;
}
interface Node { readonly topicId: string; readonly dims: Dims; readonly lastIdx: number; readonly count: number }

export async function expandCombinations(input: ExpandInput): Promise<ExpansionResult> {
  const { family, policy, space, rules } = input;
  const minItems = policy.minItems[family.minItemsKey];
  if (minItems === undefined) throw new RangeError(`a política não define o mínimo de itens para “${family.minItemsKey}”`);
  const maxDims = family.longTail ? policy.longTailMaxDimensions : policy.maxDimensions;
  const log: LogEntry[] = []; const kept: Kept[] = [];
  const seen = new Set<string>(input.roots.map((r) => r.topicId));
  let evaluated = 0; let capped = false;
  let frontier: Node[] = [];
  for (const r of [...input.roots].sort((a, b) => (a.topicId < b.topicId ? -1 : 1))) frontier.push({ topicId: r.topicId, dims: normalizeDimensions(r.dimensions), lastIdx: -1, count: (await space.count(r.dimensions)) ?? 0 });
  let level = 1;
  while (frontier.length > 0 && !capped) {
    const survivors: { node: Node; parent: Node; di: number; demand: DemandInfo | null; excl: number }[] = [];
    for (const parent of frontier) {
      for (let di = parent.lastIdx + 1; di < family.expandable.length && !capped; di++) {
        const dimId = family.expandable[di]!;
        if (dimId in parent.dims) continue;
        const values = [...new Set(await space.values(dimId, parent.dims))].sort();
        for (const v of values) {
          if (evaluated >= policy.maxCandidatesPerRun) {
            capped = true;
            log.push({ topicId: parent.topicId, parentTopicId: null, family: family.id, level, dimensions: parent.dims, outcome: "capped", filter: "cap", reason: `teto de ${policy.maxCandidatesPerRun} candidatos por execução atingido: a expansão foi interrompida (nada foi cortado em silêncio além deste ponto)`, details: { evaluated } });
            break;
          }
          evaluated++;
          const dims = normalizeDimensions({ ...parent.dims, [dimId]: v });
          const id = topicId(input.tenantId, dims);
          const base = { topicId: id, parentTopicId: parent.topicId, family: family.id, level, dimensions: dims };
          if (seen.has(id)) { log.push({ ...base, outcome: "duplicate", filter: null, reason: "o mesmo conjunto de dimensões já foi avaliado nesta execução (ou é o próprio pai)", details: {} }); continue; }
          seen.add(id);
          const prune = (filter: LogEntry["filter"], reason: string, details: Record<string, unknown> = {}) => { log.push({ ...base, outcome: "pruned", filter, reason, details }); };
          // F1
          const incompat = rules.map((r) => ({ r, why: r.check(dims) })).find((x) => x.why !== null);
          if (incompat) { prune("F1_semantic", `${incompat.r.id}: ${incompat.why}`, { rule: incompat.r.id }); continue; }
          // F2
          const geo = await space.entityOk(dims);
          if (geo) { prune("F2_entity_geo", geo); continue; }
          // F3
          if (Object.keys(dims).length > maxDims) { prune("F3_depth", `${Object.keys(dims).length} dimensões acima do máximo de ${maxDims}`, { max: maxDims }); continue; }
          // F4
          const count = await space.count(dims);
          if (count === null) { prune("F4_data_sufficiency", "dado desconhecido: não há como contar o conjunto resultante (ausência não é zero)", { count: null }); continue; }
          if (count < minItems) { prune("F4_data_sufficiency", `${count} item(ns) abaixo do mínimo de ${minItems} da família`, { count, min: minItems }); continue; }
          // F5
          const excl = await space.exclusiveBlocks(dims, parent.dims);
          if (family.parentRedundancy !== false && count > policy.redundancyRatio * parent.count) { prune("F5_parent_redundancy", `o filtro quase não filtra: ${count} de ${parent.count} itens do pai (limite ${policy.redundancyRatio * 100}%); vira seção ou filtro da página pai, não uma URL`, { count, parentCount: parent.count, ratio: Number((count / parent.count).toFixed(4)) }); continue; }
          if (excl < policy.minExclusiveBlocks) { prune("F5_parent_redundancy", `nenhum bloco de dados exclusivo em relação ao pai (mínimo ${policy.minExclusiveBlocks})`, { exclusiveBlocks: excl }); continue; }
          survivors.push({ node: { topicId: id, dims, lastIdx: di, count }, parent, di, demand: await space.demand(dims), excl });
        }
      }
    }
    // F6 (marca) e F7 (disputa de intenção) sobre os que passaram em F1–F5, em ordem determinística
    const groups = new Map<string, typeof survivors>();
    for (const s of survivors) { const k = space.intentKey(s.node.dims); groups.set(k, [...(groups.get(k) ?? []), s]); }
    const next: Node[] = [];
    for (const [key, members] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const ranked = [...members].sort((a, b) => b.node.count - a.node.count || (a.node.topicId < b.node.topicId ? -1 : 1));
      const existing = input.existingIntents.get(key);
      for (const [i, s] of ranked.entries()) {
        const b = { topicId: s.node.topicId, parentTopicId: s.parent.topicId, family: family.id, level, dimensions: s.node.dims };
        const loser = existing !== undefined && existing !== s.node.topicId ? { by: existing, why: "já existe um tópico com a mesma intenção" } : i > 0 ? { by: ranked[0]!.node.topicId, why: "outro candidato com a mesma intenção tem mais itens" } : null;
        if (loser) { log.push({ ...b, outcome: "pruned", filter: "F7_cannibalization", reason: `canibalização (${loser.why}): vira canônico ou seção de ${loser.by}`, details: { intentKey: key, winner: loser.by, count: s.node.count } }); continue; }
        const observed = s.demand !== null && s.demand.value !== null;
        const demandStatus = observed ? "OBSERVED" as const : "HYPOTHESIS" as const;
        log.push({ ...b, outcome: "kept", filter: null, reason: observed ? "passou em todos os filtros, com sinal de demanda" : "passou em todos os filtros; sem sinal de demanda: segue como hipótese (RESEARCH_REQUIRED na avaliação)", details: { count: s.node.count, exclusiveBlocks: s.excl, demandStatus, intentKey: key } });
        kept.push({ topicId: s.node.topicId, parentTopicId: s.parent.topicId, dimensions: s.node.dims, level, count: s.node.count, demand: s.demand, demandStatus, exclusiveBlocks: s.excl });
        next.push(s.node);
      }
    }
    frontier = next.sort((a, b) => (a.topicId < b.topicId ? -1 : 1));
    level++;
  }
  return { kept, log, capped, evaluated };
}
