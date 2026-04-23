import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];

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
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
