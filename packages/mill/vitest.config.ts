import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];

export default defineConfig({
  test: {
    environment: "node",
    // The skill-claims tests need neither mongod nor its oracle; the root
    // config runs them under its own jsdom project (as it does silo's).
    exclude: ["**/node_modules/**", "tests/skill-claims/**"],
    // Boot one real mongod for the whole run, then validate every mutating test
    // against it (see tests/global-setup.ts, tests/setup.ts, tests/mongo-oracle.ts).
    globalSetup: ["./tests/global-setup.ts"],
    setupFiles: ["./tests/setup.ts"],
    // Booting mongod (and downloading its binary on a cold CI cache) is slow.
    hookTimeout: 240_000,
  },
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
