"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase/browser";

type AuthState = {
  /** `false` em modo demonstração (Supabase não configurado): não há login. */
  configured: boolean;
  email: string | null;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState>({ configured: false, email: null, signOut: async () => undefined });

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const client = useMemo(() => browserClient(), []);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let active = true;
    void client.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email ?? null);
    });
    const { data } = client.auth.onAuthStateChange((_event, session) => setEmail(session?.user.email ?? null));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  const signOut = useCallback(async () => {
    if (!client) return;
    await client.auth.signOut();
    router.replace("/login");
    router.refresh();
  }, [client, router]);

  const value = useMemo<AuthState>(() => ({ configured: client !== null, email, signOut }), [client, email, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
