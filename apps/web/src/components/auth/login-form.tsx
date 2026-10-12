"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/field";
import { BrandMark } from "@/components/shell/brand-mark";
import { browserClient } from "@/lib/supabase/browser";

export function LoginForm() {
  const router = useRouter();
  const client = useMemo(() => browserClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  if (!client) {
    return (
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6">
        <BrandMark />
        <h1 className="text-lg font-semibold tracking-tight">Login não configurado</h1>
        <p className="text-sm text-muted-foreground">O Supabase não está configurado neste ambiente, então o protótipo roda em modo demonstração, sem login e com dados fictícios.</p>
        <Link href="/" className={buttonVariants({ size: "lg" })}>Abrir o protótipo</Link>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "Informe um e-mail válido.";
    if (password.length === 0) next.password = "Informe a senha.";
    setErrors(next);
    if (next.email || next.password) return;
    setBusy(true);
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        // Mensagem genérica de propósito: não revela se o e-mail existe.
        const unavailable = error.name === "AuthRetryableFetchError" || !error.status || error.status >= 500; // rede fora do ar ou erro do serviço
        setErrors({ form: unavailable ? "O serviço de login está indisponível. Verifique a conexão e tente de novo." : "E-mail ou senha inválidos." });
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setErrors({ form: "Não foi possível falar com o serviço de login. Verifique a conexão e tente de novo." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6">
      <BrandMark />
      <h1 className="text-lg font-semibold tracking-tight">Entrar</h1>
      <Field id="login-email" label="E-mail" error={errors.email}>
        <input id="login-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? "login-email-error" : undefined} className={inputClass} />
      </Field>
      <Field id="login-password" label="Senha" error={errors.password}>
        <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={errors.password ? true : undefined} aria-describedby={errors.password ? "login-password-error" : undefined} className={inputClass} />
      </Field>
      {errors.form ? <p role="alert" className="text-sm text-destructive">{errors.form}</p> : null}
      <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</Button>
      <p className="text-xs text-muted-foreground">As contas são criadas pelo administrador. Não há cadastro nesta tela.</p>
    </form>
  );
}
