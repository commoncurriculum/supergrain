/**
 * Performance benchmarks using Chrome DevTools tracing.
 *
 * Mirrors the exact setup from js-framework-benchmark's benchmarksPlaywright.ts:
 * same warmup counts, same click targets, same trace-based timing (script + paint),
 * same CPU throttling rates per benchmark.
 *
 * Run: `pnpm test:perf`
 */
import { execSync } from "child_process";
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
import {
  type CPUDurationResult,
  computeResultsCPU,
  computeResultsJS,
  computeResultsPaint,
} from "./timeline";

const ctx: TestContext = {} as TestContext;
const PROFILE = !!process.env.PROFILE;

interface BenchmarkResult {
  name: string;
  total: number;
  script: number;
  paint: number;
  layouts: number;
  numberCommits: number;
  maxDeltaBetweenCommits: number;
  rafLongDelay: number;
  droppedNonMainProcessCommitEvents: boolean;
  droppedNonMainProcessOtherEvents: boolean;
  heapUsedDelta: number;
  heapTotalDelta: number;
  domNodesDelta: number;
}

async function getMetrics(client: any): Promise<Record<string, number>> {
  const { metrics } = await client.send("Performance.getMetrics");
  const map: Record<string, number> = {};
  for (const m of metrics) map[m.name] = m.value;
  return map;
}

async function timeClick(
  page: Page,
  selector: string,
  opts: { cpuThrottle?: number; afterClick?: () => Promise<void>; traceName?: string } = {},
): Promise<Omit<BenchmarkResult, "name">> {
  const client = await page.context().newCDPSession(page);

  if (opts.cpuThrottle) {
    await client.send("Emulation.setCPUThrottlingRate", { rate: opts.cpuThrottle });
  }

  // Profiling: heap + CPU flame graph (adds overhead, opt-in via --profile)
  let metricsBefore: Record<string, number> | undefined;
  if (PROFILE) {
    await client.send("Performance.enable");
    await client.send("HeapProfiler.collectGarbage");
    metricsBefore = await getMetrics(client);
    await client.send("Profiler.enable");
    await client.send("Profiler.start");
  }

  await client.send("Tracing.start", {
    categories: "blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline",
  });

  // Match Krause's clickElement: page.$() + elem.click()
  const elem = await page.$(selector);
  if (!elem) throw new Error(`Element not found: ${selector}`);
  await elem.click();
  await elem.dispose();

  // Match Krause: wait for the DOM assertion, then 40ms for paint to finish
  if (opts.afterClick) {
    await opts.afterClick();
  }
  await page.waitForTimeout(40);

  const traceEvents = await new Promise<any[]>((resolve) => {
    const chunks: any[] = [];
    client.on("Tracing.dataCollected" as any, (data: any) => chunks.push(...data.value));
    client.on("Tracing.tracingComplete" as any, () => resolve(chunks));
    client.send("Tracing.end");
  });

  // Save CPU profile + snapshot heap (only when profiling)
  let metricsAfter: Record<string, number> | undefined;
  if (PROFILE) {
    if (opts.traceName) {
      const { profile } = await client.send("Profiler.stop");
      await client.send("Profiler.disable");
      const profilePath = resolve(__dirname, `../${opts.traceName}.cpuprofile`);
      writeFileSync(profilePath, JSON.stringify(profile));
    }
    metricsAfter = await getMetrics(client);
    await client.send("Performance.disable");
  }

  // Use Krause's exact trace parsing logic from timeline.ts
  const cpuResult = computeResultsCPU(traceEvents, "click");
  const total = cpuResult.duration;
  const script = computeResultsJS(cpuResult, traceEvents);
  const paint = computeResultsPaint(cpuResult, traceEvents);

  if (opts.cpuThrottle) {
    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  await client.detach();
  return {
    total,
    script,
    paint,
    layouts: cpuResult.layouts,
    numberCommits: cpuResult.numberCommits,
    maxDeltaBetweenCommits: cpuResult.maxDeltaBetweenCommits,
    rafLongDelay: cpuResult.raf_long_delay,
    droppedNonMainProcessCommitEvents: cpuResult.droppedNonMainProcessCommitEvents,
    droppedNonMainProcessOtherEvents: cpuResult.droppedNonMainProcessOtherEvents,
    heapUsedDelta:
      metricsBefore && metricsAfter
        ? metricsAfter.JSHeapUsedSize - metricsBefore.JSHeapUsedSize
        : 0,
    heapTotalDelta:
      metricsBefore && metricsAfter
        ? metricsAfter.JSHeapTotalSize - metricsBefore.JSHeapTotalSize
        : 0,
    domNodesDelta: metricsBefore && metricsAfter ? metricsAfter.Nodes - metricsBefore.Nodes : 0,
  };
}

const results: BenchmarkResult[] = [];

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

      // Write JSON results with git metadata
      const git = (cmd: string) => execSync(cmd, { encoding: "utf-8" }).trim();
      const timestamp = new Date().toISOString();
      const json = {
        timestamp,
        git: {
          branch: git("git rev-parse --abbrev-ref HEAD"),
          commit: git("git rev-parse --short HEAD"),
          message: git("git log -1 --pretty=%s"),
          dirty: git("git status --porcelain") !== "",
        },
        results,
        totals: {
          total: results.reduce((s, r) => s + r.total, 0),
          script: results.reduce((s, r) => s + r.script, 0),
          paint: results.reduce((s, r) => s + r.paint, 0),
          layouts: results.reduce((s, r) => s + r.layouts, 0),
          numberCommits: results.reduce((s, r) => s + r.numberCommits, 0),
          rafLongDelay: results.reduce((s, r) => s + r.rafLongDelay, 0),
          heapUsedDelta: results.reduce((s, r) => s + r.heapUsedDelta, 0),
          heapTotalDelta: results.reduce((s, r) => s + r.heapTotalDelta, 0),
          domNodesDelta: results.reduce((s, r) => s + r.domNodesDelta, 0),
        },
      };
      const jsonPath = resolve(
        __dirname,
        `../perf-results-${timestamp.replace(/[:.]/g, "-")}.json`,
      );
      writeFileSync(jsonPath, JSON.stringify(json, null, 2) + "\n");
      writeFileSync(
        resolve(__dirname, "../perf-results.json"),
        JSON.stringify(json, null, 2) + "\n",
      );
      console.log(`\nJSON results written to: ${jsonPath}`);
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
      traceName: "create-1k",
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
      traceName: "replace-1k",
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
      traceName: "partial-update",
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
      traceName: "select-row",
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
      traceName: "swap-rows",
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
      traceName: "remove-row",
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
      traceName: "create-10k",
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
      traceName: "append-1k",
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
      traceName: "clear-rows",
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
