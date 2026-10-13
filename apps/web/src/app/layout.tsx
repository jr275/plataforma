import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: { default: `${brand.name} — protótipo`, template: `%s · ${brand.name}` },
  description: "Protótipo visual com dados demonstrativos. Ambiente de teste, não indexável.",
  // Regra 5: ambientes de teste saem com noindex.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Aplica o tema salvo antes da primeira pintura (evita o "piscar" claro/escuro). Só lê a preferência local. */}
        <script
          dangerouslySetInnerHTML={{
            __html: 'try{var p=JSON.parse(localStorage.getItem("skos.demo.v1")||"{}");if(p&&p.prefs&&p.prefs.theme==="dark"){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark"}}catch(e){}',
          }}
        />
      </head>
      <body className="min-h-full">
        {children}
      </body>
    </html>
  );
}
