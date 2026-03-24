/**
 * Development build config for heap snapshot analysis.
 *
 * Differences from production vite.config.ts:
 * - No minification (readable constructor/function names in heap snapshots)
 * - Forces React development builds (unminified, real class/function names)
 * - Resolves alien-signals from source when available
 */
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@supergrain/core": resolve(__dirname, "../core/src/index.ts"),
      "@supergrain/react": resolve(__dirname, "../react/src/index.ts"),
    },
  },

  // No minification — preserve all names for heap analysis.
  build: {
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
  },

  // Force development mode so React uses unminified builds.
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
  },

  base: "",
});
