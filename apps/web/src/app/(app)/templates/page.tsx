import { TEMPLATE_REGISTRY } from "@plataforma/api";
import { TemplateGallery } from "@/components/intelligence/template-gallery";
export const metadata = { title: "Templates" };
export default function Page() { return <TemplateGallery contracts={TEMPLATE_REGISTRY.map(({ key, version, entityKind, requiredFacts, knownFacts, structuredData, sections }) => ({ key, version, entityKind, requiredFacts, knownFacts, structuredData, sections }))} />; }
