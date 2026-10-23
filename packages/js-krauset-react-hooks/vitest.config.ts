import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

import { playwrightProvider } from "../../vitest.playwright";

export default defineConfig({
  plugins: [react()],
  test: {
    browser: {
      enabled: true,
      provider: playwrightProvider(),
      instances: [
        {
          browser: "chromium",
        },
      ],
      headless: true,
    },
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/dist.test.ts"],
  },
  resolve: {
    alias: {
      "@supergrain/kernel": resolve(__dirname, "../kernel/src/index.ts"),
      "@supergrain/kernel/react": resolve(__dirname, "../kernel/src/react/index.ts"),
    },
  },
});
