import { playwright } from "@vitest/browser-playwright";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [
        {
          browser: "chromium",
        },
      ],
    },
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@supergrain/core": resolve(__dirname, "../core/src"),
      "@supergrain/store": resolve(__dirname, "../store/src"),
      "@supergrain/queries": resolve(__dirname, "./src"),
    },
  },
});
