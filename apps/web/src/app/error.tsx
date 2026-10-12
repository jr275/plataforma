"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-20 text-center">
      <p className="text-sm font-medium">Algo deu errado ao carregar esta tela</p>
      <p className="max-w-sm text-xs text-muted-foreground">{error.message || "Erro inesperado."}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={reset}>Tentar de novo</Button>
    </div>
  );
}
