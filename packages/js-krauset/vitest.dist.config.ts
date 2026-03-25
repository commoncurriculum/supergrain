import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/dist.test.ts", "src/perf.test.ts", "src/bisect-create.test.ts"],
    testTimeout: 60000,
  },
});
