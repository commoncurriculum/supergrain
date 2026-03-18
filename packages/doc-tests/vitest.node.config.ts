import { defineConfig } from "vitest/config";
import { resolve } from "path";

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
      "@supergrain/store": resolve(__dirname, "../store/src"),
    },
  },
});
