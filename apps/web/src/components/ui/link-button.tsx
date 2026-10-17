import Link from "next/link";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

/**
 * Botão com aparência de botão que NAVEGA (renderiza um <a>). A biblioteca de botões presume um <button> nativo; quando o elemento
 * renderizado é um link é preciso avisar com `nativeButton={false}`, senão o console acusa erro a cada uso. Centralizado aqui para
 * que ninguém precise lembrar disso.
 */
export function LinkButton({ href, ...props }: { href: string } & Omit<ComponentProps<typeof Button>, "render" | "nativeButton">) {
  return <Button nativeButton={false} render={<Link href={href} />} {...props} />;
}
