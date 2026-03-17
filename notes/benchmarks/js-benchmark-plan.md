# krausest/js-framework-benchmark Integration Guide

> **Status**: Current. Step-by-step guide for running supergrain in the krausest benchmark locally vs react-zustand.

## Setup

```bash
# Prerequisites: node.js v20.9.0+
git clone https://github.com/krausest/js-framework-benchmark.git
cd js-framework-benchmark
npm ci
npm run install-local
```

## Implement Your Framework

Create `frameworks/keyed/my-framework/` with:

1. **`package.json`**: Must have `build-prod` script. Use fixed dependency versions (`"1.2.3"`, not `"^1.2.3"`).
2. **`index.html`**: Replicate HTML structure from `frameworks/keyed/vanillajs/index.html`. Button `id`s and table class names must match exactly. Link to `<link href="/css/currentStyle.css" rel="stylesheet" />`.
3. **Application logic** handling: create 1k/10k rows, append 1k, update every 10th, clear all, swap two, select row, remove row.

## Run

```bash
# Terminal 1: start web server
npm start

# Terminal 2: run benchmarks
npm run bench -- --framework keyed/my-framework keyed/react-zustand

# Generate results table
npm run results
```

View results at http://localhost:8080/webdriver-ts-results/table.html
