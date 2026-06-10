import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        internal: "src/internal.ts",
        "processors/index": "src/processors/index.ts",
        "processors/json-api": "src/processors/json-api.ts",
        "react/index": "src/react/index.ts",
        "react/json-api": "src/react/json-api.ts",
      },
      name: "SupergrainDocumentStore",
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      // `effect` is a peer dependency — never bundle it into the dist.
      external: ["@supergrain/kernel", "effect", "react", "react/jsx-runtime"],
      output: {
        globals: {
          "@supergrain/kernel": "SupergrainCore",
          react: "React",
        },
      },
    },
  },
  plugins: [
    dts({
      tsconfigPath: "./tsconfig.json",
    }),
  ],
});
