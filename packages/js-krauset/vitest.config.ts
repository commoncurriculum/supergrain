import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  plugins: [react()],
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [
        {
          browser: "chromium",
        },
      ],
      headless: true,
    },
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@supergrain/core": resolve(__dirname, "../core/src/index.ts"),
      "@supergrain/react": resolve(__dirname, "../react/src/index.ts"),
    },
  },
});
