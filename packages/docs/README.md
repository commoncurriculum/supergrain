# @supergrain/docs

The Supergrain documentation site, built with [Fumadocs](https://fumadocs.dev)
on **React Router v8** + **Vite 8** + **MDX**.

It's a regular pnpm workspace package: install from the repo root with
`pnpm install`, and it depends on `@supergrain/kernel` via `workspace:*`, so the
twoslash examples compile against the current kernel source.

## Commands

Run from `packages/docs` (or with `pnpm --filter @supergrain/docs <cmd>`):

```bash
pnpm dev        # local dev server
pnpm build      # static build for GitHub Pages -> build/client/supergrain/
pnpm typecheck  # react-router typegen + fumadocs-mdx + tsc --noEmit
pnpm generate   # regenerate the package pages only (dev/build/typecheck do this)
```

## Content

- Pages live in `content/docs/` as `.md` (CommonMark, used for the ported
  package READMEs) or `.mdx` (when a page embeds React components).
- Sidebar order is controlled by `content/docs/meta.json`.
- Each page needs frontmatter with at least a `title`.

The package pages (`kernel`, `husk`, `silo`, `queries`, `mill`) are **generated**
from each package's `README.md` by `scripts/generate-readme-pages.mjs`, so the
READMEs stay the single source of truth. The generated files are gitignored;
edit the README, not `content/docs/<pkg>.md`. `readme-pages.json` lists which
packages get a page, plus each page's title and description. To add a package,
add an entry there, to `meta.json`, and to `.gitignore`.

Everything else in `content/docs/` (`index.mdx`, `comparison.md`) is a
hand-written docs-only page. `@supergrain/doc-tests` validates the
`DOC_TEST` examples in those pages and in every package README.

## Branding & layout

- Site name, GitHub repo, and routes: `app/lib/shared.ts`
- Nav / layout options: `app/lib/layout.shared.tsx`
- Landing page: `app/routes/home.tsx`
- MDX component overrides: `app/components/mdx.tsx`

## Deployment

`.github/workflows/docs.yml` builds this package and deploys
`build/client/supergrain/` to GitHub Pages at
`https://commoncurriculum.github.io/supergrain/`.

The `/supergrain/` base path is configured in two places that must stay in sync:
`base` in `vite.config.ts` and `basename` in `react-router.config.ts`. React
Router prerenders pages under the basename (`build/client/supergrain/...`) but
Vite writes assets at the build root, so the `buildEnd` hook in
`react-router.config.ts` moves everything under `build/client/supergrain/`.

## Known follow-ups

- **Live interactive demos** — embed real `@supergrain/kernel` components in
  `.mdx` pages (aliasing kernel source) to show fine-grained re-rendering.
