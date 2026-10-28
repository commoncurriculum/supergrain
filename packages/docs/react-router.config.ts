import type { Config } from "@react-router/dev/config";

import { createGetUrl, getSlugs } from "fumadocs-core/source";
import { glob, readdir, rename } from "node:fs/promises";
import { join } from "node:path";

import { getPageImagePath } from "./app/lib/og";
import { docsContentRoute } from "./app/lib/shared";

const getUrl = createGetUrl("/docs");
const basename = "/supergrain/";

export default {
  ssr: true,
  // Served from a GitHub Pages project subpath; keep in sync with `base` in vite.config.ts.
  basename,
  // React Router writes each prerendered page at its full URL path, basename
  // included (build/client/supergrain/docs/index.html), but Vite writes hashed
  // assets and public files at the build root (build/client/assets/). Neither
  // has an option to change that, and GitHub Pages serves a project site's
  // artifact root at /supergrain/, so move everything under one directory once
  // the build (prerender included) is done. The Pages artifact is
  // build/client/supergrain/.
  // A static deploy has no server to answer lazy route-discovery (/__manifest)
  // requests, so ship the full route manifest with the initial page.
  routeDiscovery: { mode: "initial" },
  async buildEnd({ reactRouterConfig }) {
    const clientDir = join(reactRouterConfig.buildDirectory, "client");
    const siteDir = basename.replace(/^\/|\/$/g, "");
    for (const entry of await readdir(clientDir)) {
      if (entry !== siteDir) await rename(join(clientDir, entry), join(clientDir, siteDir, entry));
    }
  },
  async prerender({ getStaticPaths }) {
    const paths: string[] = [];
    // Prerender everything for a static GitHub Pages deploy, including the
    // search index (/api/search) — there is no server to answer queries, so the
    // client downloads this static index and searches in-browser.
    const excluded: string[] = [];

    for (const path of getStaticPaths()) {
      if (!excluded.includes(path)) paths.push(path);
    }

    for await (const entry of glob("**/*.{md,mdx}", { cwd: "content/docs" })) {
      const slugs = getSlugs(entry);

      paths.push(getUrl(slugs));
      paths.push(getPageImagePath(slugs));
      // Per-page markdown ("copy markdown" / "view as markdown" / agents).
      paths.push(`${docsContentRoute}/${[...slugs, "content.md"].join("/")}`);
    }

    return paths;
  },
} satisfies Config;
