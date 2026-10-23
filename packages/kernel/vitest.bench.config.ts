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
      headless: true,
      instances: [
        {
          browser: "chromium",
        },
      ],
    },
    setupFiles: ["./tests/react/setup.ts"],
    globals: true,
    include: ["benchmarks/react/**/*.bench.{ts,tsx}"],
    benchmark: {
      include: ["benchmarks/react/**/*.bench.{ts,tsx}"],
      reporters: ["verbose"],
    },
  },
  resolve: {
    alias: {
      "@supergrain/kernel": resolve(__dirname, "./src"),
    },
  },
});
