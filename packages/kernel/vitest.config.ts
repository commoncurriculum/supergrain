import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "tests/react/**"],
    environmentMatchGlobs: [["tests/foreach-benchmark.test.tsx", "jsdom"]],
  },
});
