import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];
const resolve = { conditions };
const ssr = { resolve: { conditions } };

const chromiumProvider = playwright({
  launchOptions: {
    args: ["--js-flags=--expose-gc", "--enable-precise-memory-info"],
  },
});

export default defineConfig({
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    projects: [
      {
        plugins: [react()],
        test: {
          include: ["packages/kernel/tests/react/**/*.memory.spec.tsx"],
          browser: {
            enabled: true,
            provider: chromiumProvider,
            headless: true,
            instances: [{ browser: "chromium" }],
          },
          setupFiles: ["./packages/kernel/tests/react/setup.ts"],
          globals: true,
        },
        resolve,
        ssr,
      },
      {
        plugins: [react()],
        test: {
          include: ["packages/husk/tests/react/**/*.memory.spec.tsx"],
          browser: {
            enabled: true,
            provider: chromiumProvider,
            headless: true,
            instances: [{ browser: "chromium" }],
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
          include: ["packages/silo/tests/react/**/*.memory.spec.tsx"],
          browser: {
            enabled: true,
            provider: chromiumProvider,
            headless: true,
            instances: [{ browser: "chromium" }],
          },
          setupFiles: ["./packages/silo/tests/react/setup.ts"],
          globals: true,
        },
        resolve,
        ssr,
      },
    ],
  },
});
