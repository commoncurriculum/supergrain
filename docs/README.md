# Supergrain Documentation

This directory contains the documentation site for Supergrain, built with [VitePress](https://vitepress.dev/).

## How It Works

The documentation site features:
- A hero section with the Supergrain logo (superhero grain)
- Feature highlights on the home page
- A quick start guide and installation instructions
- Custom utility-first CSS (Tailwind-inspired) for styling

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
