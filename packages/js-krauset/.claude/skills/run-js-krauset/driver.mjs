#!/usr/bin/env node
// Drives the running benchmark app in a real Chromium.
//
// Commands come from argv (one per arg) or stdin (one per line), and run in
// order against a single page, so a whole flow is one process:
//
//   node driver.mjs "goto http://127.0.0.1:5173/" "click #run" "count tbody tr"
//
// The interesting command is `mutations`, which is what makes this worth
// having over a plain screenshot: it counts the DOM nodes React actually
// touched during an interaction. That number is the observable signature of
// fine-grained reactivity — see the comment on runMutations below.

// The Chromium that ships in this image. Playwright's own download is pinned to
// a build number that is usually NOT the one present here, so letting Playwright
// pick its default executable fails with "Executable doesn't exist". Resolve a
// real chrome binary instead and hand it over explicitly.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  if (!existsSync(root)) return undefined;
  // Prefer a full chromium over a headless_shell: the shell build cannot take
  // non-headless screenshots and reports a different UA.
  const dirs = readdirSync(root)
    .filter((d) => d.startsWith("chromium") && !d.includes("headless"))
    .sort();
  for (const d of dirs.reverse()) {
    const p = join(root, d, "chrome-linux", "chrome");
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Count the DOM nodes an interaction actually mutates.
 *
 * Fine-grained reactivity is invisible in a screenshot: a component that forgot
 * `tracked()` renders the right pixels on first paint and simply stops updating,
 * and one that lost its per-property subscriptions still shows correct data — it
 * just rewrites far more of the tree than it needs to. Both are silent.
 *
 * So: attach a MutationObserver to `container`, click `clickSel`, and report
 * what changed. Interpreting the number is the caller's job, but the two
 * failure signatures are:
 *   0 changes            -> nothing is subscribed (a missing `tracked()`)
 *   ~every row changed   -> subscriptions are too coarse
 */
async function runMutations(page, containerSel, clickSel) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`mutations: no element for ${sel}`);
    globalThis.__mut = { attrs: 0, chars: 0, added: 0, removed: 0, touched: new Set() };
    globalThis.__obs = new MutationObserver((records) => {
      for (const r of records) {
        const m = globalThis.__mut;
        if (r.type === "attributes") m.attrs++;
        if (r.type === "characterData") m.chars++;
        m.added += r.addedNodes.length;
        m.removed += r.removedNodes.length;
        // Attribute each record to its enclosing <tr> so the count reads as
        // "rows touched" rather than "raw records" — that's the number worth
        // reasoning about. Keyed by element identity, NOT by id: the benchmark
        // rows carry their id in a <td>, not on the <tr>, so an id-based key
        // silently counts zero.
        const node = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        const row = node && node.closest ? node.closest("tr") : null;
        if (row) m.touched.add(row);
        for (const n of [...r.addedNodes, ...r.removedNodes]) {
          if (n.nodeType === 1 && n.tagName === "TR") m.touched.add(n);
        }
      }
    });
    globalThis.__obs.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }, containerSel);

  await page.click(clickSel);
  // One rAF plus a beat: React commits and the observer drains as microtasks.
  await page.waitForTimeout(300);

  const out = await page.evaluate(() => {
    globalThis.__obs.disconnect();
    const m = globalThis.__mut;
    return {
      attrs: m.attrs,
      chars: m.chars,
      added: m.added,
      removed: m.removed,
      rowsTouched: m.touched.size,
    };
  });
  return out;
}

async function main() {
  const fromArgv = process.argv.slice(2);
  let cmds = fromArgv;
  if (cmds.length === 0) {
    const stdin = await new Promise((res) => {
      let b = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (d) => (b += d));
      process.stdin.on("end", () => res(b));
    });
    cmds = stdin
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  }

  const executablePath = findChrome();
  const browser = await chromium.launch({
    executablePath,
    // --no-sandbox is required as root in a container; --disable-gpu keeps
    // software rendering from warning on every launch.
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  page.on("console", (m) => {
    if (m.type() === "error") console.log(`[console.error] ${m.text()}`);
  });
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));

  let failed = false;
  try {
    for (const line of cmds) {
      const sp = line.indexOf(" ");
      const cmd = sp === -1 ? line : line.slice(0, sp);
      const rest = sp === -1 ? "" : line.slice(sp + 1).trim();

      switch (cmd) {
        case "goto":
          await page.goto(rest, { waitUntil: "domcontentloaded" });
          console.log(`goto ${rest} -> ${page.url()}`);
          break;
        case "click":
          await page.click(rest);
          console.log(`click ${rest}`);
          break;
        case "wait":
          await page.waitForSelector(rest, { timeout: 15000 });
          console.log(`wait ${rest} -> present`);
          break;
        case "sleep":
          await page.waitForTimeout(Number(rest));
          break;
        case "count":
          console.log(`count ${rest} -> ${await page.locator(rest).count()}`);
          break;
        case "text":
          console.log(
            `text ${rest} -> ${JSON.stringify((await page.locator(rest).first().textContent()) ?? null)}`,
          );
          break;
        case "eval":
          console.log(`eval -> ${JSON.stringify(await page.evaluate(rest))}`);
          break;
        case "shot":
          await page.screenshot({ path: rest, fullPage: false });
          console.log(`shot -> ${rest}`);
          break;
        case "mutations": {
          // mutations <containerSel> -- <clickSel>
          const [container, clickSel] = rest.split(" -- ").map((s) => s.trim());
          const r = await runMutations(page, container, clickSel);
          console.log(`mutations ${container} -- ${clickSel} -> ${JSON.stringify(r)}`);
          break;
        }
        default:
          throw new Error(`unknown command: ${cmd}`);
      }
    }
  } catch (e) {
    failed = true;
    console.error(`DRIVER FAILED: ${e.message}`);
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}

main();
