import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      exclude: ["tests/**"],
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
      },
      name: "@supergrain/activity",
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      external: ["xstate", "@supergrain/kernel", "alien-signals"],
      output: [
        {
          format: "es",
          entryFileNames: (chunk) => (chunk.name === "index" ? "index.js" : `${chunk.name}.js`),
          chunkFileNames: "chunks/[name]-[hash].js",
        },
        {
          format: "cjs",
          entryFileNames: (chunk) => (chunk.name === "index" ? "index.cjs" : `${chunk.name}.cjs`),
          chunkFileNames: "chunks/[name]-[hash].cjs",
        },
      ],
    },
  },
});
