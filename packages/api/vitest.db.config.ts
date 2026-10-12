import { defineConfig } from "vitest/config";

// Testes contra um PostgreSQL 16 real e descartável, preparado por scripts/test-api.sh.
export default defineConfig({
  test: { include: ["src/**/*.db.test.ts"], testTimeout: 30000, fileParallelism: false },
});
