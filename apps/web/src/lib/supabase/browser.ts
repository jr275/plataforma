import { createBrowserClient } from "@supabase/ssr";
import { supabaseConfig } from "./config";

/** Cliente do navegador, ou `null` em modo demonstração. Usa só a chave pública. */
export function browserClient() {
  const config = supabaseConfig();
  return config ? createBrowserClient(config.url, config.key) : null;
}
