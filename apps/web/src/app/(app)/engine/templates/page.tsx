import type { Metadata } from "next";
import { TemplateInspectorView } from "@/components/engine/factory-views2";
import { templateInspector } from "@/lib/server/factory";

export const metadata: Metadata = { title: "Templates e módulos" };
export default function Page() { return <TemplateInspectorView items={templateInspector()} />; }
