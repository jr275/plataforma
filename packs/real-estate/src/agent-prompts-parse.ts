import { createHash } from "node:crypto";

// Extrai os prompts do arquivo `prompts/02_prompts_agentes_runtime.md` (fonte única, lida por inteiro): o cabeçalho comum e o bloco ```text de cada agente. O TS gerado a partir daqui
// (agent-prompts.generated.ts) carrega a versão do prompt = sha256 do arquivo; um teste garante que o gerado não diverge do arquivo.
export interface ParsedPrompts { readonly sourceSha256: string; readonly header: string; readonly agents: readonly { readonly id: number; readonly name: string; readonly purpose: string; readonly body: string }[] }
const FENCE = /```text\n([\s\S]*?)\n```/;
export function parsePrompts(md: string): ParsedPrompts {
  const sourceSha256 = createHash("sha256").update(md).digest("hex");
  const sections = md.split(/\n## /).slice(1);
  const head = sections.find((s) => s.startsWith("0. Cabeçalho comum"));
  const header = head && FENCE.exec(head)?.[1];
  if (!header) throw new Error("cabeçalho comum não encontrado no arquivo de prompts");
  const agents = sections.flatMap((s) => {
    const m = /^Agente (\d+): (.+)\n/.exec(s); if (!m) return [];
    const body = FENCE.exec(s)?.[1]; if (!body) throw new Error(`prompt do agente ${m[1]} sem bloco text`);
    const fn = /\*\*Função:\*\* (.+)/.exec(s)?.[1] ?? "";
    return [{ id: Number(m[1]), name: m[2]!.trim(), purpose: fn.trim(), body }];
  });
  if (agents.length !== 8 || agents.some((a, i) => a.id !== i + 1)) throw new Error(`esperados 8 agentes em ordem; encontrados ${agents.map((a) => a.id).join(",")}`);
  return { sourceSha256, header, agents };
}
export function renderGenerated(p: ParsedPrompts): string {
  return `// GERADO por scripts/gen-agent-prompts.sh a partir de packs/real-estate/prompts/02_prompts_agentes_runtime.md: não edite à mão.\nexport const AGENT_PROMPTS_SOURCE = { file: "02_prompts_agentes_runtime.md", sha256: ${JSON.stringify(p.sourceSha256)} } as const;\nexport const AGENT_PROMPT_VERSION = ${JSON.stringify(`prompts-${p.sourceSha256.slice(0, 12)}`)};\nexport const AGENT_HEADER = ${JSON.stringify(p.header)};\nexport const AGENT_PROMPTS: Readonly<Record<number, { readonly name: string; readonly purpose: string; readonly body: string }>> = ${JSON.stringify(Object.fromEntries(p.agents.map((a) => [a.id, { name: a.name, purpose: a.purpose, body: a.body }])), null, 1)};\n`;
}
