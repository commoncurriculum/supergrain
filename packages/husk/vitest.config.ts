import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "tests/react/**"],
  },
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
