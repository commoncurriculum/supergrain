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
      external: ["@supergrain/kernel", "@supergrain/kernel/internal", "alien-signals"],
      output: {
        globals: {
          "@supergrain/kernel": "SupergrainCore",
          "@supergrain/kernel/internal": "SupergrainCoreInternal",
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
