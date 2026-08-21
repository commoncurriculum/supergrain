---
name: run-js-krauset
description: Build, launch, and drive the js-krauset benchmark app — the reference React app that consumes @supergrain/kernel. Use to run or start the benchmark app, screenshot it, click through its UI, check that a kernel change still renders, verify fine-grained reactivity in a real browser, or debug a blank page. Also the pattern to copy for driving any React app built on @supergrain/*.
---

# Run js-krauset

Paths are relative to `packages/js-krauset/`. Every command here was run in a headless Linux container.

React 19 + `@supergrain/kernel` rendering a table of up to 10,000 rows, with buttons to create, append, update, swap, select, and remove. It is driven by `.claude/skills/run-js-krauset/driver.mjs` — a Playwright script that clicks, screenshots, and (the part worth having) **counts the DOM nodes an interaction actually mutates**.

## Prerequisites

None to install. Chromium ships in this image at `/opt/pw-browsers/`. **Do not run `playwright install`** — see Gotchas.

## Build

From the **repo root**:

```bash
pnpm install
pnpm --filter="@supergrain/kernel" run build
```

The kernel build is not optional. `node_modules/@supergrain/kernel` is a symlink to the workspace package, and vite resolves it through that package's `import` condition to `dist/`. With no `dist/`, the dev server still starts and serves a page — it is just blank (see Troubleshooting).

## Run (agent path)

Start the dev server and wait for it, from `packages/js-krauset/`:

```bash
(pnpm dev --port 5173 --host 127.0.0.1 > /tmp/vite.log 2>&1 &)
until curl -sf http://127.0.0.1:5173/ -o /dev/null; do sleep 0.5; done
```

Then drive it. Commands run in order against one page, so a whole flow is one process:

```bash
node .claude/skills/run-js-krauset/driver.mjs \
  "goto http://127.0.0.1:5173/" \
  "click #run" \
  "wait tbody tr" \
  "count tbody tr" \
  "shot /tmp/krauset.png"
```

Prints `count tbody tr -> 1000` and writes the screenshot. **Open the screenshot and look at it.**

| Command                               | Effect                            |
| ------------------------------------- | --------------------------------- |
| `goto <url>`                          | Navigate                          |
| `click <sel>`                         | Click                             |
| `wait <sel>`                          | Wait for selector (15s timeout)   |
| `count <sel>`                         | Print match count                 |
| `text <sel>`                          | Print first match's textContent   |
| `eval <js>`                           | Evaluate in the page, print JSON  |
| `shot <path>`                         | Screenshot to path                |
| `mutations <container> -- <clickSel>` | Click and report what the DOM did |
| `sleep <ms>`                          | Pause                             |

Commands can also be piped on stdin, one per line. Any failure exits non-zero. Page `console.error` and uncaught errors are echoed with a `[console.error]` / `[pageerror]` prefix.

Button ids: `#run` (1k rows), `#runlots` (10k), `#add`, `#update` (every 10th), `#clear`, `#swaprows`. A row's label is `tbody tr:nth-child(N) td:nth-child(2) a` — clicking it selects; the `✖` in the 3rd cell removes.

### Verifying fine-grained reactivity

This is why the driver exists. A screenshot cannot tell you reactivity is wired: a component that forgot `tracked()` paints correctly once and then silently stops updating, and one whose subscriptions went coarse still shows correct data while rewriting the whole tree. Both are invisible. The mutation count is not:

```bash
node .claude/skills/run-js-krauset/driver.mjs \
  "goto http://127.0.0.1:5173/" "click #run" "wait tbody tr" \
  "mutations tbody -- #update" \
  "mutations tbody -- #swaprows" \
  "mutations tbody -- tbody tr:nth-child(3) td:nth-child(2) a"
```

Observed on 1,000 rows — treat these as the expected values:

| Interaction  | Result                              | Meaning                                 |
| ------------ | ----------------------------------- | --------------------------------------- |
| `#update`    | `chars:100, rowsTouched:100`        | exactly the 100 changed rows, not 1,000 |
| `#swaprows`  | `added:2, removed:2, rowsTouched:2` | the O(1) DOM move, not a re-render      |
| select a row | `attrs:1, rowsTouched:1`            | one className flip                      |

Two failure signatures: **`rowsTouched: 0`** means nothing is subscribed — almost always a missing `tracked()`. **`rowsTouched` near the row count** means subscriptions went coarse. Either is a regression even though the app still looks right.

## Run (human path)

```bash
pnpm dev
```

Opens on `http://localhost:5173/`. Useless headless — there is no browser to look at. Use the driver.

## Test

```bash
CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm test
```

Builds the production bundle and runs 10 correctness checks in Playwright (~15s). **The env var is required here** — without it the run fails before any test body executes. `pnpm build-prod` alone just writes `dist/`.

To drive the production bundle instead of the dev server (this is what consumers get from npm):

```bash
(cd dist && python3 -m http.server 5174 --bind 127.0.0.1 &)
node .claude/skills/run-js-krauset/driver.mjs "goto http://127.0.0.1:5174/" "click #run" "count tbody tr"
```

Same mutation counts as dev — verified.

## Gotchas

- **Never run `playwright install`.** The npm `playwright` here wants a browser build number that is not the one in `/opt/pw-browsers` (it asked for `chromium_headless_shell-1228`; the image has `1194`). The fix is always to point at the existing binary, not to download: the driver resolves it automatically, and `pnpm test` takes `CHROMIUM_EXECUTABLE_PATH`. Installing would fetch hundreds of MB to work around a path.
- **The driver skips `headless_shell` builds** when auto-detecting and picks a full `chromium-*`. The shell build cannot take ordinary screenshots.
- **`--no-sandbox` is mandatory** — the driver passes it. Chromium will not launch as root without it.
- **A blank page is the normal symptom of an unbuilt kernel**, not a crash. The dev server reports ready and serves HTML; only the module request 500s.
- **`vite.config.ts` claims the app uses published packages from npm.** It does not — `node_modules/@supergrain/kernel` is a workspace symlink, so you are testing local source. That comment is stale; changes to `packages/kernel` do show up after a rebuild.
- **A `favicon.ico` 404 on every load is expected** and harmless. Any _other_ 404 or a 500 is real.
- **`#runlots` creates 10,000 rows** and makes subsequent `mutations` runs slow. Prefer `#run` unless you are specifically testing scale.

## Troubleshooting

| Symptom                                                                                                                         | Fix                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Executable doesn't exist at .../chromium_headless_shell-1228/...` plus a "Please run playwright install" box                   | Set `CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Do not install.                    |
| Page loads but `count #run -> 0`, and `/tmp/vite.log` shows `Failed to resolve import "@supergrain/kernel" from "src/main.tsx"` | Kernel is not built. `pnpm --filter="@supergrain/kernel" run build` from the repo root.                               |
| `MODULE_NOT_FOUND` running the driver                                                                                           | You `cd`'d elsewhere. The driver path is relative to `packages/js-krauset/`; use an absolute path if you moved.       |
| `mutations` returns all zeros                                                                                                   | The container selector matched nothing, or the click changed nothing. Confirm rows exist first with `count tbody tr`. |
| Port already in use                                                                                                             | A server from an earlier run is still up. Pick another port, or `pkill -f "vite --port"`.                             |
