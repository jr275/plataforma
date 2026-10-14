#!/usr/bin/env bash
# Gera packs/real-estate/src/agent-prompts.generated.ts a partir do arquivo de prompts (fonte única).
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT/packages/api" && pnpm exec tsx -e 'import { readFileSync, writeFileSync } from "node:fs"; import { parsePrompts, renderGenerated } from "../../packs/real-estate/src/agent-prompts-parse"; writeFileSync("../../packs/real-estate/src/agent-prompts.generated.ts", renderGenerated(parsePrompts(readFileSync("../../packs/real-estate/prompts/02_prompts_agentes_runtime.md", "utf8"))));'
