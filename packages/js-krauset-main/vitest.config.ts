import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { playwrightProvider } from "../../vitest.playwright";

const conditions = ["@supergrain/source"];

export default defineConfig({
  plugins: [react()],
  test: {
    browser: {
      enabled: true,
      provider: playwrightProvider(),
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
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
