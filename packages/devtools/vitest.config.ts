import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];

// Framework-agnostic core tests (serialization + silo snapshot). The React
// panel is covered separately under tests/react via vitest.browser.config.ts.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/react/**/*.test.{ts,tsx}"],
    environment: "node",
  },
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
