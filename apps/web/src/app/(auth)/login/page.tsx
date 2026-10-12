import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <LoginForm />
    </main>
  );
}
