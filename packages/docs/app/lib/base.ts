/**
 * Prefix an app-absolute path (one starting with "/") with the Vite base path,
 * so it resolves under the GitHub Pages subpath (e.g. `/supergrain/`).
 *
 * React Router's <Link> applies the basename automatically; raw string URLs —
 * the static search index, OG images, and per-page markdown endpoints — do not,
 * so they go through here.
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}
