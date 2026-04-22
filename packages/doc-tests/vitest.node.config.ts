import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/readme-validation.test.ts"],
  },
  resolve: {
    alias: {
      "@supergrain/kernel": resolve(__dirname, "../kernel/src"),
      "@supergrain/kernel/react": resolve(__dirname, "../kernel/src/react"),
      "@supergrain/silo": resolve(__dirname, "../silo/src"),
    },
  },
});
