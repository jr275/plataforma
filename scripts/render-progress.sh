#!/usr/bin/env bash
# Gera docs/product/ENGINE_PROGRESS.md a partir do registro de andamento (packages/api/src/engine/progress.ts).
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT/packages/api" && pnpm exec tsx -e 'import { writeFileSync } from "node:fs"; import { ENGINE_PROGRESS, renderProgressMarkdown } from "./src/engine/progress"; writeFileSync("../../docs/product/ENGINE_PROGRESS.md", renderProgressMarkdown(ENGINE_PROGRESS));'
