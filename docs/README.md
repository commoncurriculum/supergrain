# Supergrain Documentation

This directory contains the documentation site for Supergrain, built with [VitePress](https://vitepress.dev/).

## How It Works

The documentation site uses the root `README.md` as its main content. The `index.md` file in this directory is a symlink to `../README.md`, so any changes to the root README are automatically reflected in the docs site.

## Local Development

To run the docs site locally:

```bash
# Start the dev server
pnpm run docs:dev

# Build the docs
pnpm run docs:build

# Preview the built docs
pnpm run docs:preview
```

## Deployment

The docs are automatically deployed to GitHub Pages when changes are pushed to the `main` branch via the `.github/workflows/docs.yml` workflow.

## Configuration

The VitePress configuration is in `.vitepress/config.mjs`. You can customize:
- Site title and description
- Navigation and sidebar
- Theme settings
- And more

See the [VitePress documentation](https://vitepress.dev/reference/site-config) for all configuration options.
