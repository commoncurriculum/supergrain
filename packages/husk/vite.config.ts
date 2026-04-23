import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
      exclude: ["tests/**"],
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "react/index": resolve(__dirname, "src/react/index.ts"),
      },
      name: "@supergrain/husk",
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "@supergrain/kernel",
        "@supergrain/kernel/internal",
        "alien-signals",
      ],
      output: [
        {
          format: "es",
          entryFileNames: (chunk) => (chunk.name === "index" ? "index.js" : `${chunk.name}.js`),
          chunkFileNames: "chunks/[name]-[hash].js",
          globals: { react: "React", "react-dom": "ReactDOM" },
        },
        {
          format: "cjs",
          entryFileNames: (chunk) => (chunk.name === "index" ? "index.cjs" : `${chunk.name}.cjs`),
          chunkFileNames: "chunks/[name]-[hash].cjs",
          globals: { react: "React", "react-dom": "ReactDOM" },
        },
      ],
    },
  },
});
