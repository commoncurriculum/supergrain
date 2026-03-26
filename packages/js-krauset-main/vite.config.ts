import react from "@vitejs/plugin-react";
/// <reference types="vitest" />
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Baseline benchmark — uses published @supergrain packages, no aliases.
export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
    react(),
  ],

  build: {
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
