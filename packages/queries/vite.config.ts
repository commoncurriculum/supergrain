import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "SupergrainQueries",
      formats: ["es", "cjs"],
      fileName: "index",
    },
    rollupOptions: {
      // `effect` is a peer dependency — never bundle it into the dist.
      external: ["@supergrain/kernel", "@supergrain/silo", "@supergrain/silo/internal", "effect"],
      output: {
        globals: {
          "@supergrain/kernel": "SupergrainCore",
          "@supergrain/silo": "SupergrainDocumentStore",
        },
      },
    },
  },
  plugins: [
    dts({
      rollupTypes: true,
      tsconfigPath: "./tsconfig.json",
    }),
  ],
});
