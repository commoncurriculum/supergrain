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
      "@supergrain/core": resolve(__dirname, "../core/src"),
      "@supergrain/react": resolve(__dirname, "../react/src"),
      "@supergrain/document-store": resolve(__dirname, "../document-store/src"),
    },
  },
});
