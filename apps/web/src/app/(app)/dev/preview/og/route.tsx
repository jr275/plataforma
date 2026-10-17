import { connection } from "next/server";
import { buildDevDetail, type DevCase } from "@/lib/dev-fixture";
import { pageOgResponse } from "@/lib/og/page-og";

// SÓ desenvolvimento (404 em produção): imagem OG da fixture, para ver o resultado sem login nem banco.
export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") return new Response("Não encontrada", { status: 404 });
  await connection(); // avaliada a cada requisição, nunca prerenderizada
  const sp = new URL(request.url).searchParams;
  const code = /^\d{7}$/.test(sp.get("city") ?? "") ? (sp.get("city") as string) : "3550308";
  const kind: DevCase = sp.get("case") === "blocked" || sp.get("case") === "no-population" ? (sp.get("case") as DevCase) : "ok";
  const built = buildDevDetail(code, kind);
  const v = built?.detail.versions[0];
  if (!built || !v) return new Response("Sem versão aprovada neste caso", { status: 404 });
  const { page } = built.detail;
  return pageOgResponse({ title: v.content.title, city: page.cityName, uf: page.uf, path: v.content.path, status: page.status, template: v.templateKey, version: v.version });
}
