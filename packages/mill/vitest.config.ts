import { defineConfig } from "vitest/config";

const conditions = ["@supergrain/source"];

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: { conditions },
  ssr: { resolve: { conditions } },
});
