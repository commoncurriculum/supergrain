import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];
const resolve = { conditions };
const ssr = { resolve: { conditions } };

export default defineConfig({
  test: {
    pool: "forks",
    // --expose-gc is required so `globalThis.gc()` is available in test workers.
    // Without it every memory test skips behind `HAS_GC`, and the sentinel test
    // fails loudly so misconfiguration is never silently invisible.
    execArgv: ["--expose-gc"],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    // Extended timeout: each memory suite runs many GC cycles (forceGc runs 6
    // gc() calls with microtask yields between them) multiplied by the number
    // of heap-sample rounds. 30 s gives comfortable headroom on slow CI agents.
    testTimeout: 30_000,
    projects: [
      {
        test: {
          include: ["packages/kernel/tests/memory/**/*.memory.spec.ts"],
          environment: "node",
        },
        resolve,
        ssr,
      },
      {
        test: {
          include: ["packages/husk/tests/memory/**/*.memory.spec.ts"],
          environment: "node",
        },
        resolve,
        ssr,
      },
      {
        test: {
          include: ["packages/silo/tests/memory/**/*.memory.spec.ts"],
          environment: "node",
        },
        resolve,
        ssr,
      },
    ],
  },
});
