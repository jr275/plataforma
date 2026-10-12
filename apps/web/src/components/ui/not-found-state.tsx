import Link from "next/link";
import { buttonVariants } from "./button";

export function NotFoundState({ what, backHref, backLabel }: { what: string; backHref: string; backLabel: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-20 text-center">
      <p className="text-sm font-medium">{what} não encontrado(a)</p>
      <p className="max-w-sm text-xs text-muted-foreground">O link pode estar desatualizado ou o registro não existe nos dados de demonstração.</p>
      <Link href={backHref} className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-3`}>{backLabel}</Link>
    </div>
  );
}
