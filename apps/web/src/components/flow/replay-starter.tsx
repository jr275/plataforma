"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** SÓ da fixture de desenvolvimento: fixa o instante de início do replay na URL (para o auto-refresh não reiniciá-lo). */
export function ReplayStarter({ hasStart, base }: { hasStart: boolean; base: string }) {
  const router = useRouter();
  useEffect(() => { if (!hasStart) router.replace(`${base}&t0=${Date.now()}`); }, [hasStart, base, router]);
  return null;
}
