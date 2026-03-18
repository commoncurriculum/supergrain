import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  test: {
    projects: [
      // Node environment for core tests (default)
      {
        test: {
          include: ["packages/core/**/*.test.{ts,tsx}"],
          environment: "node",
        },
      },
      // Node environment for app-store tests
      {
        test: {
          include: ["packages/store/**/*.test.{ts,tsx}"],
          environment: "node",
        },
        resolve: {
          alias: {
            "@supergrain/core": resolve(__dirname, "./packages/core/src"),
            "@supergrain/store": resolve(__dirname, "./packages/store/src"),
          },
        },
      },
      // Browser environment for React tests
      {
        plugins: [react()],
        test: {
          include: [
            "packages/react/**/*.test.{ts,tsx}",
            "packages/react-example/**/*.test.{ts,tsx}",
          ],
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
          setupFiles: ["./packages/react/tests/setup.ts"],
          globals: true,
        },
        resolve: {
          alias: {
            "@supergrain/core": resolve(__dirname, "./packages/core/src"),
            "@supergrain/react": resolve(__dirname, "./packages/react/src"),
          },
        },
      },
    ],
  },
});
