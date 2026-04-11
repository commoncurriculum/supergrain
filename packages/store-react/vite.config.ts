import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "@supergrain/store-react",
      fileName: (format) => `index.${format}.js`,
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      external: ["react", "@supergrain/core", "@supergrain/react", "@supergrain/store"],
      output: {
        globals: {
          react: "React",
          "@supergrain/core": "supergrainCore",
          "@supergrain/react": "supergrainReact",
          "@supergrain/store": "supergrainStore",
        },
      },
    },
  },
});
