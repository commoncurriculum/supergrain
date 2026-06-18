# @supergrain/docs

The Supergrain documentation site, built with [Fumadocs](https://fumadocs.dev)
on **React Router v8** + **Vite 8** + **MDX**.

## Why this is an isolated sub-project

This package is intentionally **excluded from the pnpm workspace**
(see `!packages/docs` in `pnpm-workspace.yaml`) and keeps its **own lockfile**.
Two reasons:

1. It runs a bleeding-edge toolchain (Vite 8 / React Router 8 / TypeScript 6)
   that we don't want leaking into the core library's dependency resolution.
2. It keeps the docs build decoupled from the rest of the monorepo, so the
   docs' deps never appear in the root `pnpm-lock.yaml`.

Because it's isolated, always install it with `--ignore-workspace`:

```bash
cd packages/docs
pnpm install --ignore-workspace
```

## Commands

```bash
pnpm dev          # local dev server
pnpm build        # production build (SSR build + static prerender)
pnpm build:pages  # build + flatten output for GitHub Pages (/supergrain/)
pnpm typecheck    # react-router typegen + fumadocs-mdx + tsc --noEmit
```

## Content

- Pages live in `content/docs/` as `.md` (CommonMark, used for the ported
  package READMEs) or `.mdx` (when a page embeds React components).
- Sidebar order is controlled by `content/docs/meta.json`.
- Each page needs frontmatter with at least a `title`.

The package pages (`kernel`, `husk`, `silo`, `queries`, `mill`) are currently
**seeded** from each package's `README.md` and are meant to diverge into
curated, docs-first content over time. The package READMEs stay the canonical
home for the tested code examples (validated by `@supergrain/doc-tests`); the
comparison guide is the one docs-only page that owns its examples here.

## Branding & layout

- Site name, GitHub repo, and routes: `app/lib/shared.ts`
- Nav / layout options: `app/lib/layout.shared.tsx`
- Landing page: `app/routes/home.tsx`
- MDX component overrides: `app/components/mdx.tsx`

## Deployment

`.github/workflows/docs.yml` builds this package in isolation and deploys the
flattened `build/client/supergrain/` directory to GitHub Pages at
`https://commoncurriculum.github.io/supergrain/`.

The `/supergrain/` base path is configured in two places that must stay in sync:
`base` in `vite.config.ts` and `basename` in `react-router.config.ts`.

## Known follow-ups

- **Live interactive demos** — embed real `@supergrain/kernel` components in
  `.mdx` pages (aliasing kernel source) to show fine-grained re-rendering.
- **Twoslash** — type-on-hover code blocks, a strong fit for a type-inference
  focused library.
- **Static search** — the example ships server-route search; a fully static
  Pages deploy needs Fumadocs' build-time (static) search index.
- **Drop the unused `vitepress` devDependency** — VitePress (the old `docs/`
  site and its root scripts) is gone, but the root `vitepress` devDependency
  can't be removed yet: that needs regenerating the root lockfile, which a
  cold `pnpm install` currently can't do because `packages/js-krauset-main`
  pins unpublished `@supergrain/core` / `@supergrain/react` packages. Remove
  `vitepress` once that pre-existing landmine is fixed.
