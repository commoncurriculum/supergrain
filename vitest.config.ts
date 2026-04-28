import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Routes every `@supergrain/*` import to source TypeScript. Matches
// `customConditions` in tsconfig.json. Both `resolve.conditions` (main)
// and `ssr.resolve.conditions` (node-env tests) must be set; vitest's
// node/jsdom runs go through Vite's SSR resolver which has its own
// condition list.
const conditions = ["@supergrain/source"];
const resolve = { conditions };
const ssr = { resolve: { conditions } };

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary", "lcov"],
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: [
        "packages/*/src/**/*.test.{ts,tsx}",
        "packages/*/dist/**",
        "packages/js-krauset*/**",
        "packages/doc-tests/**",
        // Pure re-export and types-only files — v8 reports them as 0% because
        // there's no executable code to attribute coverage to. Skipping them
        // keeps the report focused on files where coverage means something.
        "packages/husk/src/index.ts",
        "packages/husk/src/react/index.ts",
        "packages/kernel/src/index.ts",
        "packages/kernel/src/internal.ts",
        "packages/kernel/src/react/index.ts",
        "packages/mill/src/index.ts",
        "packages/queries/src/index.ts",
        "packages/queries/src/types.ts",
        "packages/silo/src/index.ts",
        "packages/silo/src/queries.ts",
      ],
      reportsDirectory: "./coverage",
    },
    projects: [
      {
        test: {
          include: ["packages/kernel/tests/{core,read,write}/**/*.test.{ts,tsx}"],
          environment: "node",
        },
        resolve,
        ssr,
      },
      {
        test: {
          include: ["packages/mill/**/*.test.{ts,tsx}"],
          environment: "node",
        },
        resolve,
        ssr,
      },
      {
        test: {
          include: ["packages/silo/tests/**/*.test.{ts,tsx}"],
          exclude: ["packages/silo/tests/react/**/*.test.{ts,tsx}"],
          environment: "node",
        },
        resolve,
        ssr,
      },
      {
        plugins: [react()],
        test: {
          include: ["packages/silo/tests/react/**/*.test.{ts,tsx}"],
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
          setupFiles: ["./packages/silo/tests/react/setup.ts"],
          globals: true,
        },
        resolve,
        ssr,
      },
      {
        test: {
          include: ["packages/queries/**/*.test.{ts,tsx}"],
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
          setupFiles: ["./packages/queries/tests/setup.ts"],
          globals: true,
        },
        resolve,
        ssr,
      },
      {
        test: {
          include: ["packages/husk/tests/core/**/*.test.{ts,tsx}"],
          environment: "node",
        },
        resolve,
        ssr,
      },
      {
        plugins: [react()],
        test: {
          include: ["packages/husk/tests/react/**/*.test.{ts,tsx}"],
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
          setupFiles: ["./packages/husk/tests/react/setup.ts"],
          globals: true,
        },
        resolve,
        ssr,
      },
      {
        plugins: [react()],
        test: {
          include: ["packages/kernel/tests/react/**/*.test.{ts,tsx}"],
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
          setupFiles: ["./packages/kernel/tests/react/setup.ts"],
          globals: true,
        },
        resolve,
        ssr,
      },
    ],
  },
});
