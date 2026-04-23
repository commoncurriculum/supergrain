import strip from "@rollup/plugin-strip";
import react from "@vitejs/plugin-react";
/// <reference types="vitest" />
import { resolve } from "path";
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

  // This is the key change:
  // We use aliasing to tell Vite to bundle the local supergrain packages
  // directly from their source code. This makes the package self-contained
  // and removes the need for a pnpm workspace when you copy this package.
  resolve: {
    alias: {
      "@supergrain/kernel": resolve(__dirname, "../kernel/src/index.ts"),
      "@supergrain/kernel/react": resolve(__dirname, "../kernel/src/react/index.ts"),
    },
  },

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
