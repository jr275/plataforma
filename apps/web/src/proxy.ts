import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";

/**
 * Proxy do Next (antes das rotas): renova a sessão do Supabase e leva quem não está logado para /login. Sem configuração do
 * Supabase (modo demonstração) não faz nada. ATENÇÃO: isto só controla o acesso à INTERFACE. A autorização por tenant é do servidor
 * (packages/api, ADR-013/015); hoje as telas ainda usam dados fictícios e não falam com o banco.
 */
export async function proxy(request: NextRequest) {
  const config = supabaseConfig();
  if (!config) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        for (const { name, value } of cookies) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
      },
    },
  });

  // getClaims verifica a assinatura do token (não confia só no cookie).
  const { data } = await supabase.auth.getClaims();
  const signedIn = typeof data?.claims?.sub === "string" && data.claims.sub.length > 0;
  const onLogin = request.nextUrl.pathname === "/login";

  if (signedIn === onLogin) {
    const target = request.nextUrl.clone();
    target.pathname = onLogin ? "/" : "/login";
    target.search = "";
    const redirect = NextResponse.redirect(target);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
