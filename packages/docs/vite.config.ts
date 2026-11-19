import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import mdx from "fumadocs-mdx/vite";
import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";

export default defineConfig({
  // Served from a GitHub Pages project subpath: https://commoncurriculum.github.io/supergrain/
  // Keep in sync with `basename` in react-router.config.ts.
  base: "/supergrain/",
  plugins: [mdx(), tailwindcss(), reactRouter()],
  // The homepage demo imports @supergrain/kernel. Resolve it to the workspace
  // source, like the other packages do, so the site needs no kernel build.
  resolve: {
    tsconfigPaths: true,
    conditions: ["@supergrain/source", ...defaultClientConditions],
  },
  ssr: {
    external: ["@takumi-rs/image-response"],
    resolve: { conditions: ["@supergrain/source", ...defaultServerConditions] },
  },
});
