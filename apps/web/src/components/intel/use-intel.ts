"use client";

import { useMemo } from "react";
import type { Opportunity, WorkspaceData } from "@/data/demo/types";
import { lifecycleOf, type Lifecycle } from "@/lib/intel/lifecycle";
import { clustersOf, scoreOpportunity, type ScoreResult, type Weights } from "@/lib/intel/score";
import { rankArchetypes, type Recommendation } from "@/lib/intel/archetypes";

export type OpportunityIntel = {
  o: Opportunity;
  score: ScoreResult;
  life: Lifecycle;
  clusters: readonly string[];
  archetype: Recommendation;
};

/** Derivações por oportunidade, recalculadas só quando o workspace (ou os pesos) mudam. */
export function useOpportunityIntel(d: WorkspaceData, weights?: Weights): OpportunityIntel[] {
  return useMemo(
    () =>
      d.opportunities.map((o) => ({
        o,
        score: scoreOpportunity(d, o, weights),
        life: lifecycleOf(d, o),
        clusters: clustersOf(d, o),
        archetype: rankArchetypes(d, o)[0],
      })),
    [d, weights],
  );
}
