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
