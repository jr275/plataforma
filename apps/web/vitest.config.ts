import path from "node:path";
import { defineConfig } from "vitest/config";

// Testes de interface: renderizam os componentes no servidor (renderToStaticMarkup) e conferem estados, textos e acessibilidade básica.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "test/server-only-stub.ts"),
      cn: path.resolve(__dirname, "node_modules/cn"),
    },
  },
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"], environment: "node" },
});
