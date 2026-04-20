import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "SupergrainOperators",
      formats: ["es", "cjs"],
      fileName: "index",
    },
    rollupOptions: {
      external: ["@supergrain/core", "@supergrain/core/internal", "alien-signals"],
      output: {
        globals: {
          "@supergrain/core": "SupergrainCore",
          "@supergrain/core/internal": "SupergrainCoreInternal",
          "alien-signals": "alienSignals",
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
