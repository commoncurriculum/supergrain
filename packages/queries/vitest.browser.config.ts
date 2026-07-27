import { defineConfig } from "vitest/config";

import { playwrightProvider } from "../../vitest.playwright";

const conditions = ["@supergrain/source"];

export default defineConfig({
  test: {
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
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
