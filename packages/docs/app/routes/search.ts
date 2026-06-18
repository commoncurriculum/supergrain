import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

const server = createFromSource(source, {
  // https://docs.orama.com/docs/orama-js/supported-languages
  language: 'english',
});

// Build-time static search index: prerendered to /api/search and downloaded by
// the client (app/components/search.tsx). Works on a static GitHub Pages deploy
// where there is no server to answer per-query search requests.
export async function loader() {
  return server.staticGET();
}
