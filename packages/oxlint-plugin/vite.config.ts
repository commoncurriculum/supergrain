import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    // A lint plugin is loaded by Node (oxlint spawns it), never bundled into a
    // browser app, so ESM only and Node as the target.
    target: "node18",
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      // The source imports `@oxlint/plugins` for types only, so nothing from
      // it should reach the bundle. Keeping it external means a stray runtime
      // import shows up as an import in dist (which tests/dist.test.ts
      // rejects) rather than being silently inlined.
      external: ["@oxlint/plugins"],
    },
  },
  plugins: [
    dts({
      bundleTypes: true,
      tsconfigPath: "./tsconfig.json",
    }),
  ],
});
