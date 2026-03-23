/**
 * Performance benchmarks using Chrome DevTools tracing.
 *
 * Mirrors the exact setup from js-framework-benchmark's benchmarksPlaywright.ts:
 * same warmup counts, same click targets, same trace-based timing (script + paint),
 * same CPU throttling rates per benchmark.
 *
 * Run: `pnpm test:perf`
 */
import { writeFileSync } from "fs";
import { resolve } from "path";
import { chromium, type Page } from "playwright";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import {
  type TestContext,
  checkDistExists,
  startServer,
  freshPage,
  waitFor,
  click,
  text,
} from "./test-helpers";

const ctx: TestContext = {} as TestContext;

async function timeClick(
  page: Page,
  selector: string,
  opts: { cpuThrottle?: number; afterClick?: () => Promise<void> } = {},
): Promise<{ total: number; script: number; paint: number }> {
  const client = await page.context().newCDPSession(page);

  if (opts.cpuThrottle) {
    await client.send("Emulation.setCPUThrottlingRate", { rate: opts.cpuThrottle });
  }

  await client.send("Tracing.start", {
    categories: "blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline",
  });

  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    if (!el) throw new Error(`Element not found: ${sel}`);
    el.click();
  }, selector);

  // Match Krause: wait for the DOM assertion, then 40ms for paint to finish
  if (opts.afterClick) {
    await opts.afterClick();
  }
  await page.waitForTimeout(40);

  const result = await new Promise<any[]>((resolve) => {
    const chunks: any[] = [];
    client.on("Tracing.dataCollected" as any, (data: any) => chunks.push(...data.value));
    client.on("Tracing.tracingComplete" as any, () => resolve(chunks));
    client.send("Tracing.end");
  });

  const SCRIPT_EVENTS = new Set([
    "EventDispatch",
    "FunctionCall",
    "TimerFire",
    "FireAnimationFrame",
  ]);
  const PAINT_EVENTS = new Set(["Layout", "Paint", "Commit"]);
  const RELEVANT_EVENTS = new Set([...SCRIPT_EVENTS, ...PAINT_EVENTS]);

  let clickTs = 0;
  let lastRelevantEnd = 0;
  let scriptTime = 0;
  let paintTime = 0;

  for (const e of result) {
    if (e.ph !== "X") continue;
    if (e.name === "EventDispatch" && e.args?.data?.type === "click" && clickTs === 0) {
      clickTs = e.ts;
    }
    if (clickTs > 0 && e.ts >= clickTs && RELEVANT_EVENTS.has(e.name)) {
      const dur = (e.dur || 0) / 1000;
      const end = e.ts + (e.dur || 0);
      if (end > lastRelevantEnd) lastRelevantEnd = end;
      if (SCRIPT_EVENTS.has(e.name)) scriptTime += dur;
      if (PAINT_EVENTS.has(e.name)) paintTime += dur;
    }
  }

  const total = clickTs > 0 ? (lastRelevantEnd - clickTs) / 1000 : 0;

  if (opts.cpuThrottle) {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  await client.detach();
  return { total, script: scriptTime, paint: paintTime };
}

const results: { name: string; total: number; script: number; paint: number }[] = [];

describe("performance benchmarks", () => {
  beforeAll(async () => {
    checkDistExists();
    const { server, baseUrl } = await startServer();
    ctx.server = server;
    ctx.baseUrl = baseUrl;
    ctx.browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    await ctx.browser?.close();
    ctx.server?.close();

    if (results.length > 0) {
      const header = `${"Operation".padEnd(30)} ${"Total".padStart(8)} ${"Script".padStart(8)} ${"Paint".padStart(8)}`;
      const lines = results.map(
        (r) =>
          `${r.name.padEnd(30)} ${(r.total.toFixed(1) + "ms").padStart(8)} ${(r.script.toFixed(1) + "ms").padStart(8)} ${(r.paint.toFixed(1) + "ms").padStart(8)}`,
      );
      const sep = "─".repeat(58);
      const output = `Benchmark Results\n${sep}\n${header}\n${sep}\n${lines.join("\n")}\n${sep}`;
      console.log(`\n${output}`);
      writeFileSync(resolve(__dirname, "../perf-results.txt"), output + "\n");
    }
  });

  // 01_run1k: 5 warmup run+clear cycles, then time run
  it("create rows (1k)", async () => {
    const page = await freshPage(ctx);
    for (let i = 0; i < 5; i++) {
      await click(page, "#run");
      await click(page, "#clear");
    }
    const ms = await timeClick(page, "#run", {
      afterClick: () => waitFor(page, "tbody>tr:nth-of-type(1000)>td:nth-of-type(1)"),
    });
    results.push({ name: "create rows (1k)", ...ms });
  });

  // 02_replace1k: 5 warmup runs (no clears), then time run
  it("replace all rows", async () => {
    const page = await freshPage(ctx);
    for (let i = 0; i < 5; i++) {
      await click(page, "#run");
    }
    const ms = await timeClick(page, "#run", {
      afterClick: () => waitFor(page, "tbody>tr:nth-of-type(1000)>td:nth-of-type(1)"),
    });
    results.push({ name: "replace all rows", ...ms });
  });

  // 03_update10th: run(1000), 3 warmup updates, then time 4th. 4x CPU throttle.
  it("partial update (every 10th)", async () => {
    const page = await freshPage(ctx);
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    for (let i = 0; i < 3; i++) {
      await click(page, "#update");
    }
    const ms = await timeClick(page, "#update", {
      cpuThrottle: 4,
      afterClick: async () => {
        // Krause checks that row 991 has the expected number of " !!!" suffixes
        await page.waitForFunction(() =>
          document
            .querySelector("tbody>tr:nth-of-type(991)>td:nth-of-type(2)>a")
            ?.textContent?.includes(" !!!"),
        );
      },
    });
    results.push({ name: "partial update (10th)", ...ms });
  });

  // 04_select1k: run(1000), select row 5 (warmup), then time select row 2. 4x CPU throttle.
  it("select row", async () => {
    const page = await freshPage(ctx);
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    await click(page, "tbody>tr:nth-of-type(5)>td:nth-of-type(2)>a");
    const ms = await timeClick(page, "tbody>tr:nth-of-type(2)>td:nth-of-type(2)>a", {
      cpuThrottle: 4,
      afterClick: async () => {
        await page.waitForFunction(() =>
          document.querySelector("tbody>tr:nth-of-type(2)")?.classList.contains("danger"),
        );
      },
    });
    results.push({ name: "select row", ...ms });
  });

  // 05_swap1k: run(1000), 6 warmup swaps, then time 7th. 4x CPU throttle.
  it("swap rows", async () => {
    const page = await freshPage(ctx);
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    for (let i = 0; i < 6; i++) {
      await click(page, "#swaprows");
    }
    const ms = await timeClick(page, "#swaprows", {
      cpuThrottle: 4,
      afterClick: async () => {
        await page.waitForFunction(
          () =>
            document.querySelector("tbody>tr:nth-of-type(2)>td:nth-of-type(1)")?.textContent ===
            "999",
        );
      },
    });
    results.push({ name: "swap rows", ...ms });
  });

  // 06_remove: run(1000), 5 warmup removes, then time remove from row 4. 2x CPU throttle.
  it("remove row", async () => {
    const page = await freshPage(ctx);
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    for (let i = 0; i < 5; i++) {
      const row = 5 - i + 4;
      await click(page, `tbody>tr:nth-of-type(${row})>td:nth-of-type(3)>a>span`);
    }
    const ms = await timeClick(page, "tbody>tr:nth-of-type(4)>td:nth-of-type(3)>a>span", {
      cpuThrottle: 2,
      afterClick: async () => {
        // After removing row 4, what was row 5 shifts into position 4
        await page.waitForFunction(
          () =>
            document.querySelector("tbody>tr:nth-of-type(4)>td:nth-of-type(1)")?.textContent ===
            "10",
        );
      },
    });
    results.push({ name: "remove row", ...ms });
  });

  // 07_create10k: 5 warmup run+clear cycles, then time runlots
  it("create many rows (10k)", async () => {
    const page = await freshPage(ctx);
    for (let i = 0; i < 5; i++) {
      await click(page, "#run");
      await click(page, "#clear");
    }
    const ms = await timeClick(page, "#runlots", {
      afterClick: () => waitFor(page, "tbody>tr:nth-of-type(10000)>td:nth-of-type(2)>a"),
    });
    results.push({ name: "create many rows (10k)", ...ms });
  });

  // 08_append: 5 warmup run+clear cycles, then run(1000), then time add
  it("append rows (1k to 1k)", async () => {
    const page = await freshPage(ctx);
    for (let i = 0; i < 5; i++) {
      await click(page, "#run");
      await click(page, "#clear");
    }
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    const ms = await timeClick(page, "#add", {
      afterClick: () => waitFor(page, "tbody>tr:nth-of-type(2000)>td:nth-of-type(1)"),
    });
    results.push({ name: "append rows (1k to 1k)", ...ms });
  });

  // 09_clear: 5 warmup run+clear cycles, then run(1000), then time clear. 4x CPU throttle.
  it("clear rows", async () => {
    const page = await freshPage(ctx);
    for (let i = 0; i < 5; i++) {
      await click(page, "#run");
      await click(page, "#clear");
    }
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    const ms = await timeClick(page, "#clear", {
      cpuThrottle: 4,
      afterClick: async () => {
        await page.waitForFunction(
          () => !document.querySelector("tbody>tr:nth-of-type(1000)>td:nth-of-type(1)"),
        );
      },
    });
    results.push({ name: "clear rows", ...ms });
  });
});
