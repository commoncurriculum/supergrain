import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // Node environment for core tests (default)
      {
        test: {
          include: ["packages/core/**/*.test.{ts,tsx}"],
          environment: "node",
        },
        resolve: {
          alias: {
            "@supergrain/core": resolve(__dirname, "./packages/core/src"),
            "@supergrain/operators": resolve(__dirname, "./packages/operators/src"),
          },
        },
      },
      // Node environment for operators tests
      {
        test: {
          include: ["packages/operators/**/*.test.{ts,tsx}"],
          environment: "node",
        },
        resolve: {
          alias: {
            "@supergrain/core": resolve(__dirname, "./packages/core/src"),
            "@supergrain/operators": resolve(__dirname, "./packages/operators/src"),
          },
        },
      },
      // @supergrain/document-store is intentionally excluded: its suite is
      // failing-pins around a not-yet-implemented skeleton. Run directly with
      // `pnpm --filter=@supergrain/document-store test`.

      // Browser environment for React tests
      {
        plugins: [react()],
        test: {
          include: ["packages/react/**/*.test.{ts,tsx}"],
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
            "@supergrain/operators": resolve(__dirname, "./packages/operators/src"),
            "@supergrain/react": resolve(__dirname, "./packages/react/src"),
          },
        },
      },
    ],
  },
});
