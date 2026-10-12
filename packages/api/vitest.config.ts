import { defineConfig } from "vitest/config";

// Testes unitários e estáticos (sem banco). Os testes que exigem PostgreSQL ficam em *.db.test.ts e rodam por
// `pnpm test:api` (scripts/test-api.sh), que sobe um cluster descartável.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], exclude: ["src/**/*.db.test.ts"] },
});
