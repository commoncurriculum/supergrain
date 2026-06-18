import type { Config } from '@react-router/dev/config';
import { glob } from 'node:fs/promises';
import { createGetUrl, getSlugs } from 'fumadocs-core/source';
import { getPageImagePath } from './app/lib/og';
import { docsContentRoute } from './app/lib/shared';

const getUrl = createGetUrl('/docs');

export default {
  ssr: true,
  basename: '/supergrain/',
  async prerender({ getStaticPaths }) {
    const paths: string[] = [];
    // Prerender everything for a static GitHub Pages deploy, including the
    // search index (/api/search) — there is no server to answer queries, so the
    // client downloads this static index and searches in-browser.
    const excluded: string[] = [];

    for (const path of getStaticPaths()) {
      if (!excluded.includes(path)) paths.push(path);
    }

    for await (const entry of glob('**/*.{md,mdx}', { cwd: 'content/docs' })) {
      const slugs = getSlugs(entry);

      paths.push(getUrl(slugs));
      paths.push(getPageImagePath(slugs));
      // Per-page markdown ("copy markdown" / "view as markdown" / agents).
      paths.push(`${docsContentRoute}/${[...slugs, 'content.md'].join('/')}`);
    }

    return paths;
  },
} satisfies Config;
