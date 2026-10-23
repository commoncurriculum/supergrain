import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { playwrightProvider } from "../../vitest.playwright";

const conditions = ["@supergrain/source"];

export default defineConfig({
  plugins: [react()],
  test: {
    browser: {
      enabled: true,
      provider: playwrightProvider() as any,
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
