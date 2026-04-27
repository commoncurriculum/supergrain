import { defineConfig } from "vitest/config";

// @supergrain/source condition makes each package resolve to its TypeScript
// source files instead of the built dist artefacts.
const conditions = ["@supergrain/source"];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    pool: "forks",
    // --expose-gc is required so `globalThis.gc()` is available in test
    // workers.  Vitest 4 reads `project.config.execArgv` (not the root
    // test.execArgv) when spawning forked workers.  Using a flat config
    // (no `projects` array) makes this the single project config, so
    // execArgv flows through correctly.  The sentinel test in every suite
    // fails loudly if gc() is absent so mis-configuration is never silent.
    execArgv: ["--expose-gc"],
    include: [
      "packages/kernel/tests/memory/**/*.memory.spec.ts",
      "packages/husk/tests/memory/**/*.memory.spec.ts",
      "packages/silo/tests/memory/**/*.memory.spec.ts",
    ],
    // Soak tests live in *.memory.soak.spec.ts and have their own config.
    exclude: ["**/*.memory.soak.spec.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    // Extended timeout: each memory suite runs many GC cycles (forceGc runs 6
    // gc() calls with microtask yields between them) multiplied by the number
    // of heap-sample rounds. 30 s gives comfortable headroom on slow CI agents.
    testTimeout: 30_000,
  },
});
