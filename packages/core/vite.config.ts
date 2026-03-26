import strip from "@rollup/plugin-strip";
import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
    strip({
      functions: [
        "profileSignalRead",
        "profileSignalSkip",
        "profileSignalWrite",
        "profileEffectFire",
      ],
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "@supergrain/core",
      fileName: (format) => `index.${format}.js`,
      formats: ["es", "cjs"],
    },
  },
});
