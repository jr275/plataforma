import type { Metadata } from "next";
import { Chakra_Petch, Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import Script from "next/script";
import { brand } from "@/config/brand";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Fontes QUADRADAS do fluxo de produção (referência: Palantir): títulos em Space Grotesk, rótulos em caixa alta em Chakra Petch. Só o fluxo as
// usa por enquanto (tokens --font-flow e --font-flow-label em globals.css); para levar a todo o produto, basta apontar --font-heading para elas.
const flowSans = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"], weight: ["400", "500", "600"] });
const flowLabel = Chakra_Petch({ variable: "--font-chakra-petch", subsets: ["latin"], weight: ["400", "500", "600"] });

export const metadata: Metadata = {
  title: { default: `${brand.name} — protótipo`, template: `%s · ${brand.name}` },
  description: "Protótipo visual com dados demonstrativos. Ambiente de teste, não indexável.",
  // Regra 5: ambientes de teste saem com noindex.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} ${flowSans.variable} ${flowLabel.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full">
        {/* Aplica o tema salvo antes da primeira pintura (evita o "piscar" claro/escuro). Só lê a preferência local. */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: 'try{var p=JSON.parse(localStorage.getItem("skos.demo.v1")||"{}");if(p&&p.prefs&&p.prefs.theme==="dark"){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark"}}catch(e){}',
          }}
        />
        {children}
      </body>
    </html>
  );
}
