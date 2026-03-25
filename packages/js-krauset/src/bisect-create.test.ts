/**
 * Bisect test: runs create 1k 15 times and reports median + all values.
 * Saves results to bisect-results/<label>.json for later analysis.
 *
 * Set BISECT_LABEL env var to tag the run (defaults to git short hash).
 *
 * Run: cd packages/js-krauset && pnpm build-prod && pnpm exec vitest run --config vitest.dist.config.ts src/bisect-create.test.ts
 */
import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { chromium, type Page } from "playwright";
import { describe, it, beforeAll, afterAll } from "vitest";

import {
  type TestContext,
  checkDistExists,
  startServer,
  freshPage,
  waitFor,
  click,
} from "./test-helpers";
import { computeResultsCPU, computeResultsJS, computeResultsPaint } from "./timeline";

const ctx: TestContext = {} as TestContext;

async function timeClick(
  page: Page,
  selector: string,
  opts: { afterClick?: () => Promise<void> } = {},
): Promise<{ total: number; script: number; paint: number }> {
  const client = await page.context().newCDPSession(page);
  await client.send("Tracing.start", {
    categories: "blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline",
  });
  const elem = await page.$(selector);
  if (!elem) throw new Error(`Element not found: ${selector}`);
  await elem.click();
  await elem.dispose();
  if (opts.afterClick) await opts.afterClick();
  await page.waitForTimeout(40);
  const traceEvents = await new Promise<any[]>((resolve) => {
    const chunks: any[] = [];
    client.on("Tracing.dataCollected" as any, (data: any) => chunks.push(...data.value));
    client.on("Tracing.tracingComplete" as any, () => resolve(chunks));
    client.send("Tracing.end");
  });
  const cpuResult = computeResultsCPU(traceEvents, "click");
  const total = cpuResult.duration;
  const script = computeResultsJS(cpuResult, traceEvents);
  const paint = computeResultsPaint(cpuResult, traceEvents);
  await client.detach();
  return { total, script, paint };
}

describe("bisect create 1k", () => {
  const runs: { total: number; script: number; paint: number }[] = [];

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

    const totals = runs.map((r) => r.total).sort((a, b) => a - b);
    const median = totals[Math.floor(totals.length / 2)];

    // Read label from bisect-label.txt if it exists, otherwise use git hash
    let label: string;
    try {
      label = require("fs").readFileSync(resolve(__dirname, "../bisect-label.txt"), "utf-8").trim();
    } catch {
      label = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
    }

    const outDir = resolve(__dirname, "../bisect-results");
    mkdirSync(outDir, { recursive: true });
    const result = {
      label,
      timestamp: new Date().toISOString(),
      operation: "create 1k",
      n: runs.length,
      median,
      runs,
    };
    writeFileSync(resolve(outDir, `${label}.json`), JSON.stringify(result, null, 2) + "\n");

    console.log(`\n\nCREATE 1K RESULTS [${label}] (n=${totals.length})`);
    console.log(`  median: ${median?.toFixed(1)}ms`);
    console.log(`  all totals: [${totals.map((v) => v.toFixed(1)).join(", ")}]`);
    console.log(`  saved to: bisect-results/${label}.json\n`);
  });

  for (let i = 0; i < 15; i++) {
    it(`run ${i + 1}`, async () => {
      const page = await freshPage(ctx);
      for (let w = 0; w < 5; w++) {
        await click(page, "#run");
        await click(page, "#clear");
      }
      const ms = await timeClick(page, "#run", {
        afterClick: () => waitFor(page, "tbody>tr:nth-of-type(1000)>td:nth-of-type(1)"),
      });
      runs.push(ms);
    });
  }
});
