import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
  },
  resolve: {
    alias: {
      "@supergrain/kernel": resolve(__dirname, "../kernel/src"),
      "@supergrain/mill": resolve(__dirname, "../mill/src"),
    },
  },
});
