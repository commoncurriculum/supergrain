import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];
const resolve = { conditions };
const ssr = { resolve: { conditions } };

export default defineConfig({
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
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
