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
      external: ["@supergrain/core", "@supergrain/document-store"],
      output: {
        globals: {
          "@supergrain/core": "SupergrainCore",
          "@supergrain/document-store": "SupergrainDocumentStore",
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
