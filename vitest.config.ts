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
        plugins: [react()],
        test: {
          include: ["packages/silo/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
        resolve,
        ssr,
      },
      {
        test: {
          include: ["packages/queries/**/*.test.{ts,tsx}"],
          environment: "jsdom",
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
