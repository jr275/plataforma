import { engine } from "@plataforma/api";
import { GeoWorkspace } from "@/components/intelligence/geo-workspace";
export const metadata = { title: "Visibilidade em IA" };
export default function Page() { return <GeoWorkspace limitation={engine.CAPABILITIES.find((c) => c.id === "ai-citations")?.detail ?? "Monitor de observações ainda não implementado."} />; }
