import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
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
