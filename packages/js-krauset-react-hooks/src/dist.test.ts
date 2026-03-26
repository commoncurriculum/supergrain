/**
 * Build validation tests.
 *
 * Serves the production build in Playwright and runs the same checks
 * as js-framework-benchmark's isKeyed.ts. If these pass, the build
 * is guaranteed to work in the Krause benchmark.
 *
 * Run: `pnpm test`
 */
import { writeFileSync } from "fs";
import { resolve } from "path";
import { chromium } from "playwright";
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

describe("dist validation (isKeyed mirror)", () => {
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
  });

  it("page loads and all benchmark buttons exist", async () => {
    const page = await freshPage(ctx);
    for (const id of ["run", "runlots", "add", "update", "clear", "swaprows"]) {
      await waitFor(page, `#${id}`);
    }
    await waitFor(page, "tbody");
  });

  it("add() creates 1000 rows with correct DOM structure", async () => {
    const page = await freshPage(ctx);
    await click(page, "#add");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");

    expect(await text(page, "tbody>tr:nth-of-type(1000)>td:nth-of-type(1)")).toBe("1000");

    const tags = await page.evaluate(() => {
      const tr = document.querySelector("tbody>tr:nth-of-type(1000)")!;
      return Array.from(tr.querySelectorAll("*")).map((el) => el.tagName.toLowerCase());
    });
    expect(tags).toEqual(["td", "td", "a", "td", "a", "span", "td"]);

    const classes = await page.evaluate(() => {
      const tr = document.querySelector("tbody>tr:nth-of-type(1000)")!;
      return Array.from(tr.querySelectorAll(":scope > td")).map((td) => td.className);
    });
    expect(classes[0]).toContain("col-md-1");
    expect(classes[1]).toContain("col-md-4");
    expect(classes[2]).toContain("col-md-1");
    expect(classes[3]).toContain("col-md-6");

    const span = "tbody>tr:nth-of-type(1000)>td:nth-of-type(3)>a>span";
    expect(await page.getAttribute(span, "aria-hidden")).toBe("true");
    const spanClass = await page.getAttribute(span, "class");
    expect(spanClass).toContain("glyphicon");
    expect(spanClass).toContain("glyphicon-remove");
  });

  it("keyed: swap rows moves DOM nodes", async () => {
    const page = await freshPage(ctx);
    await click(page, "#add");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    await click(page, "#swaprows");
    expect(await text(page, "tbody>tr:nth-of-type(2)>td:nth-of-type(1)")).toBe("999");
  });

  it("keyed: run replaces all rows", async () => {
    const page = await freshPage(ctx);
    await click(page, "#add");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    await click(page, "#swaprows");
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    expect(await text(page, "tbody>tr:nth-of-type(1000)>td:nth-of-type(1)")).toBe("2000");
  });

  it("keyed: remove deletes the correct row", async () => {
    const page = await freshPage(ctx);
    await click(page, "#add");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    await click(page, "#swaprows");
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");

    expect(await text(page, "tbody>tr:nth-of-type(2)>td:nth-of-type(1)")).toBe("1002");
    await click(page, "tbody>tr:nth-of-type(2)>td:nth-of-type(3)>a>span");
    await page.waitForTimeout(500);
    expect(await text(page, "tbody>tr:nth-of-type(2)>td:nth-of-type(1)")).toBe("1003");
  });

  it("select row highlights with danger class", async () => {
    const page = await freshPage(ctx);
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");
    await click(page, "tbody>tr:nth-of-type(5)>td:nth-of-type(2)>a");
    expect(await page.getAttribute("tbody>tr:nth-of-type(5)", "class")).toContain("danger");
    expect(await page.getAttribute("tbody>tr:nth-of-type(4)", "class")).not.toContain("danger");
  });

  it("partial update: profile render counts at 1000 rows", async () => {
    const page = await freshPage(ctx);
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");

    // Start profiling, click update, wait for DOM change
    await page.evaluate(() => (window as any).__startProfiling());
    await click(page, "#update");
    await page.waitForFunction(() =>
      document
        .querySelector("tbody>tr:nth-of-type(1)>td:nth-of-type(2)>a")
        ?.textContent?.includes(" !!!"),
    );
    await page.waitForTimeout(100);

    const p = await page.evaluate(() => (window as any).__getProfilingResults());
    console.log("Partial update profiling (1000 rows):", JSON.stringify(p, null, 2));

    // Core assertion: only 100 rows should re-render, not 1000
    expect(p.rowRenderCount).toBe(100);
    // App and For should NOT re-render
    expect(p.appRenderCount).toBe(0);
    // Signal writes: exactly 100 label changes
    expect(p.signalWrites).toBe(100);
  });

  it("select row: profile render counts at 1000 rows", async () => {
    const page = await freshPage(ctx);
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");

    // Warmup select
    await click(page, "tbody>tr:nth-of-type(5)>td:nth-of-type(2)>a");
    await page.waitForTimeout(200);

    // Start profiling, select a different row
    await page.evaluate(() => (window as any).__startProfiling());
    await click(page, "tbody>tr:nth-of-type(2)>td:nth-of-type(2)>a");
    await page.waitForFunction(() =>
      document.querySelector("tbody>tr:nth-of-type(2)")?.classList.contains("danger"),
    );
    await page.waitForTimeout(100);

    const p = await page.evaluate(() => (window as any).__getProfilingResults());
    console.log("Select row profiling (1000 rows):", JSON.stringify(p, null, 2));

    // Only 2 rows should re-render (deselect old + select new)
    expect(p.rowRenderCount).toBe(2);
    // App should NOT re-render
    expect(p.appRenderCount).toBe(0);
  });

  it("capture flamegraph trace for select row", async () => {
    const page = await freshPage(ctx);
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");

    // Warmup select
    await click(page, "tbody>tr:nth-of-type(5)>td:nth-of-type(2)>a");
    await page.waitForTimeout(200);

    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await client.send("Tracing.start", {
      categories: [
        "blink.user_timing",
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "v8.execute",
        "disabled-by-default-v8.cpu_profiler",
      ].join(","),
    });

    const elem = await page.$("tbody>tr:nth-of-type(2)>td:nth-of-type(2)>a");
    await elem!.click();
    await elem!.dispose();
    await page.waitForFunction(() =>
      document.querySelector("tbody>tr:nth-of-type(2)")?.classList.contains("danger"),
    );
    await page.waitForTimeout(100);

    const traceEvents = await new Promise<any[]>((res) => {
      const chunks: any[] = [];
      client.on("Tracing.dataCollected" as any, (data: any) => chunks.push(...data.value));
      client.on("Tracing.tracingComplete" as any, () => res(chunks));
      client.send("Tracing.end");
    });

    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await client.detach();

    const tracePath = resolve(__dirname, "../select-row-trace.json");
    writeFileSync(tracePath, JSON.stringify(traceEvents));
    console.log(`Select row trace written to ${tracePath}`);
    expect(traceEvents.length).toBeGreaterThan(0);
  }, 30000);

  it("capture flamegraph trace for partial update", async () => {
    const page = await freshPage(ctx);
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)");

    // Warmup
    await click(page, "#update");
    await page.waitForTimeout(200);

    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await client.send("Tracing.start", {
      categories: [
        "blink.user_timing",
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "v8.execute",
        "disabled-by-default-v8.cpu_profiler",
      ].join(","),
    });

    const elem = await page.$("#update");
    await elem!.click();
    await elem!.dispose();
    await page.waitForFunction(() =>
      document
        .querySelector("tbody>tr:nth-of-type(1)>td:nth-of-type(2)>a")
        ?.textContent?.includes(" !!! !!!"),
    );
    await page.waitForTimeout(100);

    const traceEvents = await new Promise<any[]>((res) => {
      const chunks: any[] = [];
      client.on("Tracing.dataCollected" as any, (data: any) => chunks.push(...data.value));
      client.on("Tracing.tracingComplete" as any, () => res(chunks));
      client.send("Tracing.end");
    });

    await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await client.detach();

    const tracePath = resolve(__dirname, "../partial-update-trace.json");
    writeFileSync(tracePath, JSON.stringify(traceEvents));
    console.log(`Flamegraph trace written to ${tracePath}`);
    console.log(`Open in Chrome: chrome://tracing → Load → ${tracePath}`);
    expect(traceEvents.length).toBeGreaterThan(0);
  }, 30000);
});
