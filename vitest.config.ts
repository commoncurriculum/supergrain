import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // Node environment for kernel core tests (default)
      {
        test: {
          include: ["packages/kernel/tests/{core,read,write}/**/*.test.{ts,tsx}"],
          environment: "node",
        },
        resolve: {
          alias: {
            "@supergrain/kernel": resolve(__dirname, "./packages/kernel/src"),
            "@supergrain/mill": resolve(__dirname, "./packages/mill/src"),
          },
        },
      },
      // Node environment for mill tests
      {
        test: {
          include: ["packages/mill/**/*.test.{ts,tsx}"],
          environment: "node",
        },
        resolve: {
          alias: {
            "@supergrain/kernel": resolve(__dirname, "./packages/kernel/src"),
            "@supergrain/mill": resolve(__dirname, "./packages/mill/src"),
          },
        },
      },
      // jsdom environment for silo tests (store, finder, processors, React hooks)
      {
        plugins: [react()],
        test: {
          include: ["packages/silo/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
        resolve: {
          alias: {
            "@supergrain/kernel": resolve(__dirname, "./packages/kernel/src"),
            "@supergrain/mill": resolve(__dirname, "./packages/mill/src"),
          },
        },
      },
      // Browser environment for React tests (kernel/react subpath)
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
        resolve: {
          alias: {
            "@supergrain/kernel": resolve(__dirname, "./packages/kernel/src"),
            "@supergrain/mill": resolve(__dirname, "./packages/mill/src"),
          },
        },
      },
    ],
  },
});
