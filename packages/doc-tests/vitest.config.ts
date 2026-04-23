import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    browser: {
      enabled: true,
      provider: playwright() as any,
      headless: true,
      instances: [
        {
          browser: "chromium",
        },
      ],
    },
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    // Exclude readme-validation test from browser mode since it needs Node.js APIs
    exclude: ["**/node_modules/**", "**/readme-validation.test.ts"],
  },
  resolve: {
    alias: {
      "@supergrain/kernel": resolve(__dirname, "../kernel/src"),
      "@supergrain/kernel/react": resolve(__dirname, "../kernel/src/react"),
      "@supergrain/silo": resolve(__dirname, "../silo/src"),
    },
  },
});
