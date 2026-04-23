import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "tests/react/**"],
    environmentMatchGlobs: [["tests/foreach-benchmark.test.tsx", "jsdom"]],
  },
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
