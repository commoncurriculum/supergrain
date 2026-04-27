import { defineConfig } from "vitest/config";

// @supergrain/source condition makes each package resolve to its TypeScript
// source files instead of the built dist artefacts.
const conditions = ["@supergrain/source"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    pool: "forks",
    execArgv: ["--expose-gc"],
    include: [
      "packages/kernel/tests/memory/**/*.memory.soak.spec.ts",
      "packages/husk/tests/memory/**/*.memory.soak.spec.ts",
      "packages/silo/tests/memory/**/*.memory.soak.spec.ts",
    ],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    // Soak runs many more cycles per round; allow more wall-clock per file.
    testTimeout: 60_000,
  },
});
