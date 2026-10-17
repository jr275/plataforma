import { getPageDetail } from "@plataforma/api";
import { pageOgResponse } from "@/lib/og/page-og";
import { loadForTenant } from "@/lib/server/tenant-data";

// Imagem OG (Vercel OG / next/og) de uma página gerada. Autenticada e por tenant: lê a página por withTenant (RLS); sem sessão, sem tenant
// ou página de outro workspace, a resposta é a MESMA 404, sem pista de que o registro existe. Nunca guardada nem publicada.
const NOT_FOUND = () => new Response("Não encontrada", { status: 404, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request, ctx: RouteContext<"/generation/pages/[id]/og">): Promise<Response> {
  const { id } = await ctx.params;
  const raw = Number.parseInt(new URL(request.url).searchParams.get("v") ?? "", 10);
  const loaded = await loadForTenant((db) => getPageDetail(db, id));
  if (loaded.state !== "ready" || !loaded.data) return NOT_FOUND();
  const { page, versions } = loaded.data;
  const v = versions.find((x) => Number.isInteger(raw) && x.version === raw) ?? versions[0];
  if (!v) return NOT_FOUND();
  return pageOgResponse({ title: v.content.title, city: page.cityName, uf: page.uf, path: v.content.path, status: page.status, template: v.templateKey, version: v.version });
}
