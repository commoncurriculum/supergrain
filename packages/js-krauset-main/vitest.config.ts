import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];

export default defineConfig({
  plugins: [react()],
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
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
