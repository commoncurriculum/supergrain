import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/readme-validation.test.ts"],
  },
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
