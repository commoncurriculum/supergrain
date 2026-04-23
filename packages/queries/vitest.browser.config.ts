import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];

export default defineConfig({
  test: {
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
    setupFiles: ["./tests/setup.ts"],
    globals: true,
  },
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
