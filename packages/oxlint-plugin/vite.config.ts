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
      // `@oxlint/plugins` is only type helpers plus pass-through functions, but
      // it stays external so a consumer's oxlint and the plugin agree on it.
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
