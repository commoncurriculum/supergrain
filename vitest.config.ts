import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { playwrightProvider } from "./vitest.playwright";

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
        "packages/silo/src/internal.ts",
        "packages/silo/src/queries.ts",
        "packages/devtools/src/index.ts",
        "packages/devtools/src/react/index.ts",
        "packages/activity/src/index.ts",
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
          include: ["packages/activity/tests/**/*.test.{ts,tsx}"],
          environment: "node",
        },
        resolve,
        ssr,
      },
      {
        // Executable checks for the behavioural claims in
        // .claude/skills/supergrain/SKILL.md — subscription scoping, the
        // captured-closure semantics of the husk hooks, and which fields each
        // envelope actually has. Run in jsdom because none of these assertions
        // need a real engine, which also keeps them off the browser projects.
        plugins: [react()],
        test: {
          name: "skill-claims",
          include: ["packages/*/tests/skill-claims/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          globals: true,
        },
        resolve,
        ssr,
      },
      // mill runs under its own config (node env + the real-mongod oracle:
      // globalSetup/setupFiles/hookTimeout). Referencing the file keeps that
      // setup in one place instead of duplicating it here.
      "./packages/mill/vitest.config.ts",
      {
        test: {
          include: ["packages/silo/tests/**/*.test.{ts,tsx}"],
          exclude: [
            "packages/silo/tests/react/**/*.test.{ts,tsx}",
            "packages/silo/tests/skill-claims/**/*.test.{ts,tsx}",
          ],
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
            provider: playwrightProvider(),
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
            provider: playwrightProvider(),
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
            provider: playwrightProvider(),
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
            provider: playwrightProvider(),
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
      {
        test: {
          include: ["packages/devtools/tests/**/*.test.{ts,tsx}"],
          exclude: ["packages/devtools/tests/react/**/*.test.{ts,tsx}"],
          environment: "node",
        },
        resolve,
        ssr,
      },
      {
        plugins: [react()],
        test: {
          include: ["packages/devtools/tests/react/**/*.test.{ts,tsx}"],
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
          setupFiles: ["./packages/devtools/tests/react/setup.ts"],
          globals: true,
        },
        resolve,
        ssr,
      },
    ],
  },
});
