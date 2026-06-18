import strip from "@rollup/plugin-strip";
import react from "@vitejs/plugin-react";
/// <reference types="vitest" />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
    react(),
    strip({
      functions: ["profileSignalRead", "profileSignalSkip", "profileSignalWrite"],
    }),
  ],

  // Uses the published @supergrain/kernel packages (resolved from node_modules),
  // not local workspace source — so the bundle matches what consumers get from npm.

  build: {
    // Keep function names readable for profiling and debugging
    minify: false,
    // The benchmark runner expects predictable, non-hashed file names.
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
  },

  // The base path must be relative for the benchmark server to find assets correctly.
  base: "",
});
