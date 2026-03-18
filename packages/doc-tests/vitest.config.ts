import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { playwright } from "@vitest/browser-playwright";

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
      "@supergrain/core": resolve(__dirname, "../core/src"),
      "@supergrain/react": resolve(__dirname, "../react/src"),
      "@supergrain/store": resolve(__dirname, "../store/src"),
    },
  },
});
