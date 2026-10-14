import { beforeEach, describe, expect, it, vi } from "vitest";

// Fronteiras mockadas: a execução por tenant (loadForTenant) e as consultas de packages/api. O mapeamento de parâmetros da URL para a
// consulta (o que este módulo faz) é a lógica REAL.
const db = { query: vi.fn() } as never;
vi.mock("./tenant-data", () => ({ loadForTenant: vi.fn(async (fn: (d: never) => Promise<unknown>) => ({ state: "ready", data: await fn(db), origin: undefined })) }));
vi.mock("@plataforma/api", async (orig) => ({ ...(await orig<typeof import("@plataforma/api")>()), searchCities: vi.fn(async () => ({ rows: [], total: 0 })), getCityDetail: vi.fn(async () => undefined) }));

import * as api from "@plataforma/api";
import { CITY_PAGE_SIZE, loadCities, loadCityDetail, parseCityParams } from "./cities";

const mSearch = vi.mocked(api.searchCities);
const mDetail = vi.mocked(api.getCityDetail);
beforeEach(() => vi.clearAllMocks());

describe("loadCities: parâmetros da URL viram a consulta, sem acréscimos", () => {
  it("padrões: sem filtros, página 1, ordem por nome; mais duas consultas de indicadores do workspace inteiro (sem filtros)", async () => {
    await loadCities(parseCityParams({}));
    expect(mSearch).toHaveBeenCalledTimes(3);
    expect(mSearch).toHaveBeenCalledWith(db, { q: undefined, uf: undefined, hasPage: undefined, sort: "name", dir: "asc", limit: CITY_PAGE_SIZE, offset: 0 });
    expect(mSearch).toHaveBeenCalledWith(db, { limit: 1 });
    expect(mSearch).toHaveBeenCalledWith(db, { hasPage: true, limit: 1 });
  });
  it("os indicadores ignoram os filtros da URL (são do workspace inteiro) e vêm dos totais do banco", async () => {
    mSearch.mockResolvedValueOnce({ rows: [], total: 7 }).mockResolvedValueOnce({ rows: [], total: 5571 }).mockResolvedValueOnce({ rows: [], total: 20 });
    const r = await loadCities(parseCityParams({ q: "x", uf: "SP", pages: "without" }));
    expect(r).toMatchObject({ state: "ready", data: { cities: { total: 7 }, summary: { total: 5571, withPage: 20 } } });
    expect(mSearch.mock.calls[1]![1]).toEqual({ limit: 1 });
    expect(mSearch.mock.calls[2]![1]).toEqual({ hasPage: true, limit: 1 });
  });
  it("filtros e paginação: o deslocamento é (página - 1) x tamanho", async () => {
    await loadCities(parseCityParams({ q: "campinas", uf: "sp", pages: "with", sort: "population", dir: "desc", page: "3" }));
    expect(mSearch.mock.calls[0]).toEqual([db, { q: "campinas", uf: "SP", hasPage: true, sort: "population", dir: "desc", limit: 20, offset: 40 }]);
  });
  it("'sem página' vira hasPage=false (e não 'sem filtro')", async () => {
    await loadCities(parseCityParams({ pages: "without" }));
    expect(mSearch.mock.calls[0]![1]!.hasPage).toBe(false);
  });
  it("valores fora da lista não chegam à consulta", async () => {
    await loadCities(parseCityParams({ uf: "ZZ", pages: "talvez", sort: "x; DROP TABLE", dir: "up", page: "-1" }));
    expect(mSearch.mock.calls[0]![1]).toEqual({ q: undefined, uf: undefined, hasPage: undefined, sort: "name", dir: "asc", limit: 20, offset: 0 });
  });
  it("nenhum tenant é passado: a consulta recebe só o `db` do contexto da sessão", async () => {
    await loadCities(parseCityParams({ tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", tenant_id: "x" }));
    expect(mSearch.mock.calls[0]![0]).toBe(db);
    expect(JSON.stringify(mSearch.mock.calls[0]![1])).not.toMatch(/tenant|bbbbbbbb/i);
  });
});

describe("loadCityDetail", () => {
  it("passa o identificador e devolve o detalhe (ou indefinido) dentro do estado `ready`", async () => {
    const r = await loadCityDetail("d0000000-0000-4000-8000-000000000001");
    expect(mDetail).toHaveBeenCalledExactlyOnceWith(db, "d0000000-0000-4000-8000-000000000001");
    expect(r).toMatchObject({ state: "ready", data: { detail: undefined } });
  });
});
