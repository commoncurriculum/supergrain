import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { playwrightProvider } from "../../vitest.playwright";

const conditions = ["@supergrain/source"];

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/react/**/*.test.{ts,tsx}"],
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
    setupFiles: ["./tests/react/setup.ts"],
    globals: true,
  },
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
