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
      "@supergrain/kernel": resolve(__dirname, "../kernel/src"),
      "@supergrain/silo": resolve(__dirname, "../silo/src"),
      "@supergrain/queries": resolve(__dirname, "./src"),
    },
  },
});
