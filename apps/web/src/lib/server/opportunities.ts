import "server-only";
import { getOpportunity, listOpportunities, type Opportunity } from "@plataforma/api";
import { loadForTenant, type Loaded } from "./tenant-data";

// Oportunidades REAIS do tenant (ADR-018/024). Só funções tipadas de packages/api, sempre dentro de withTenant (via loadForTenant):
// o isolamento entre tenants é do RLS. Somente leitura nesta fatia. Cada situação que a interface precisa distinguir é um estado
// explícito de `Loaded`; nenhuma delas vira dado de demonstração (a tela só usa a demo quando o ambiente não tem login/banco).

export function loadOpportunityList(): Promise<Loaded<Opportunity[]>> {
  return loadForTenant((db) => listOpportunities(db));
}

/** `null` = não existe neste tenant OU pertence a outro (indistinguíveis de propósito). */
export function loadOpportunityDetail(id: string): Promise<Loaded<Opportunity | null>> {
  return loadForTenant(async (db) => (await getOpportunity(db, id)) ?? null);
}
