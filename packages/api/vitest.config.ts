import { defineConfig } from "vitest/config";

// Testes unitários e estáticos (sem banco). Os testes que exigem PostgreSQL ficam em *.db.test.ts (`pnpm test:api`) e em
// *.product.test.ts (`pnpm test:schema`); ambos sobem um cluster descartável.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], exclude: ["src/**/*.db.test.ts", "src/**/*.product.test.ts"] },
});
