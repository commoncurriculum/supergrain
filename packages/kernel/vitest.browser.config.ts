import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/react/**/*.test.{ts,tsx}"],
    browser: {
      enabled: true,
      // CHROMIUM_EXECUTABLE_PATH lets environments with a pre-installed
      // browser run without `playwright install`.
      provider: playwright(
        process.env.CHROMIUM_EXECUTABLE_PATH
          ? { launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } }
          : undefined,
      ),
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
