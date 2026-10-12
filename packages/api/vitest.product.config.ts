import { defineConfig } from "vitest/config";

// Testes das funções de produto contra o esquema REAL (migrations 0001/0002) num PostgreSQL 16 descartável, preparado por
// scripts/test-schema.sh (pnpm test:schema).
export default defineConfig({
  test: { include: ["src/**/*.product.test.ts"], testTimeout: 30000, fileParallelism: false },
});
