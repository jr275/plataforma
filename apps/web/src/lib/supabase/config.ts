// Configuração PÚBLICA do Supabase (a mesma que o navegador usa): URL do projeto e chave pública (anon/publishable). NUNCA coloque
// aqui a chave de serviço nem qualquer segredo. Sem as duas variáveis (ou com valores inválidos), o app roda em MODO DEMONSTRAÇÃO:
// sem login, com os dados fictícios de sempre.
export type SupabasePublicConfig = { url: string; key: string };

export function supabaseConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return { url, key };
}
