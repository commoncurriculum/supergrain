import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          include: ["tests/**/*.test.{ts,tsx}"],
          exclude: ["tests/react/**/*.test.{ts,tsx}"],
          environment: "node",
        },
        resolve: { conditions },
        ssr: { resolve: { conditions } },
      },
      {
        plugins: [react()],
        test: {
          include: ["tests/react/**/*.test.{ts,tsx}"],
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
        },
        resolve: { conditions },
        ssr: { resolve: { conditions } },
      },
    ],
  },
});
