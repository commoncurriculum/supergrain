import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "@supergrain/react",
      fileName: (format) => `index.${format}.js`,
      formats: ["es", "cjs"],
    },
    rollupOptions: {
      external: ["react", "@supergrain/core"],
      output: {
        globals: {
          react: "React",
          "@supergrain/core": "supergrainCore",
        },
      },
    },
  },
});
