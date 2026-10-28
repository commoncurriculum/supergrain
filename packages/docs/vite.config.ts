import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // Served from a GitHub Pages project subpath: https://commoncurriculum.github.io/supergrain/
  // Keep in sync with `basename` in react-router.config.ts.
  base: "/supergrain/",
  plugins: [mdx(), tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
  ssr: {
    external: ["@takumi-rs/image-response"],
  },
});
