import strip from "@rollup/plugin-strip";
import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      exclude: ["examples/**", "tests/**", "benchmarks/**"],
    }),
    strip({
      functions: ["profileSignalRead", "profileSignalSkip", "profileSignalWrite"],
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "react/index": resolve(__dirname, "src/react/index.ts"),
      },
      name: "@supergrain/kernel",
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "@supergrain/kernel", "alien-signals"],
      output: [
        {
          format: "es",
          entryFileNames: (chunk) => (chunk.name === "index" ? "index.es.js" : `${chunk.name}.js`),
          chunkFileNames: "chunks/[name]-[hash].js",
          globals: { react: "React", "react-dom": "ReactDOM" },
        },
        {
          format: "cjs",
          entryFileNames: (chunk) =>
            chunk.name === "index" ? "index.cjs.js" : `${chunk.name}.cjs`,
          chunkFileNames: "chunks/[name]-[hash].cjs",
          globals: { react: "React", "react-dom": "ReactDOM" },
        },
      ],
    },
  },
});
