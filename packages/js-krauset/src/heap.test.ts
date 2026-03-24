/**
 * Heap snapshot comparison: before vs after create 1k rows.
 *
 * Uses CDP HeapProfiler to capture object counts by constructor,
 * giving us concrete data on per-row allocation cost.
 *
 * Run: `pnpm test:heap`
 */
import { writeFileSync } from "fs";
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

const ctx: TestContext = {} as TestContext;

interface HeapStats {
  totalSize: number;
  totalCount: number;
  byConstructor: Map<string, { count: number; size: number }>;
}

async function captureHeapStats(page: Page): Promise<HeapStats> {
  const client = await page.context().newCDPSession(page);

  // Force GC first for clean measurement
  await client.send("HeapProfiler.collectGarbage");
  await new Promise((r) => setTimeout(r, 100));
  await client.send("HeapProfiler.collectGarbage");
  await new Promise((r) => setTimeout(r, 100));

  // Capture heap snapshot as a string
  let snapshotData = "";
  client.on("HeapProfiler.addHeapSnapshotChunk" as any, (params: any) => {
    snapshotData += params.chunk;
  });
  await client.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false } as any);
  await client.detach();

  // Parse the V8 heap snapshot format
  const snapshot = JSON.parse(snapshotData);
  const nodes = snapshot.nodes as number[];
  const strings = snapshot.strings as string[];
  const nodeFields = snapshot.snapshot.meta.node_fields as string[];

  const typeIdx = nodeFields.indexOf("type");
  const nameIdx = nodeFields.indexOf("name");
  const selfSizeIdx = nodeFields.indexOf("self_size");
  const nodeFieldCount = nodeFields.length;

  const nodeTypes = snapshot.snapshot.meta.node_types[0] as string[];

  const byConstructor = new Map<string, { count: number; size: number }>();
  let totalSize = 0;
  let totalCount = 0;

  for (let i = 0; i < nodes.length; i += nodeFieldCount) {
    const type = nodeTypes[nodes[i + typeIdx]];
    const name = strings[nodes[i + nameIdx]];
    const selfSize = nodes[i + selfSizeIdx];

    // Skip synthetic/internal nodes
    if (type === "synthetic" || type === "hidden") continue;

    const key = `${type}:${name}`;
    const existing = byConstructor.get(key);
    if (existing) {
      existing.count++;
      existing.size += selfSize;
    } else {
      byConstructor.set(key, { count: 1, size: selfSize });
    }
    totalSize += selfSize;
    totalCount++;
  }

  return { totalSize, totalCount, byConstructor };
}

function diffHeapStats(
  before: HeapStats,
  after: HeapStats,
): { key: string; countDelta: number; sizeDelta: number }[] {
  const allKeys = new Set([...before.byConstructor.keys(), ...after.byConstructor.keys()]);
  const diffs: { key: string; countDelta: number; sizeDelta: number }[] = [];

  for (const key of allKeys) {
    const b = before.byConstructor.get(key) ?? { count: 0, size: 0 };
    const a = after.byConstructor.get(key) ?? { count: 0, size: 0 };
    const countDelta = a.count - b.count;
    const sizeDelta = a.size - b.size;
    if (countDelta !== 0 || sizeDelta !== 0) {
      diffs.push({ key, countDelta, sizeDelta });
    }
  }

  // Sort by absolute count delta descending
  diffs.sort((a, b) => Math.abs(b.countDelta) - Math.abs(a.countDelta));
  return diffs;
}

describe("heap snapshot analysis", () => {
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

  it("create 1k rows: heap allocation breakdown", async () => {
    const page = await freshPage(ctx);

    // Warmup: 3 run+clear cycles to stabilize
    for (let i = 0; i < 3; i++) {
      await click(page, "#run");
      await waitFor(page, "tbody>tr:nth-of-type(1000)>td:nth-of-type(1)");
      await click(page, "#clear");
      await page.waitForTimeout(200);
    }

    // Snapshot BEFORE
    console.log("Taking heap snapshot BEFORE create 1k...");
    const before = await captureHeapStats(page);
    console.log(
      `Before: ${before.totalCount.toLocaleString()} objects, ${(before.totalSize / 1024).toFixed(0)} KB`,
    );

    // Create 1k rows
    await click(page, "#run");
    await waitFor(page, "tbody>tr:nth-of-type(1000)>td:nth-of-type(1)");
    await page.waitForTimeout(100); // Let effects settle

    // Snapshot AFTER
    console.log("Taking heap snapshot AFTER create 1k...");
    const after = await captureHeapStats(page);
    console.log(
      `After: ${after.totalCount.toLocaleString()} objects, ${(after.totalSize / 1024).toFixed(0)} KB`,
    );

    // Diff
    const diffs = diffHeapStats(before, after);
    const totalCountDelta = after.totalCount - before.totalCount;
    const totalSizeDelta = after.totalSize - before.totalSize;

    // Format output
    const lines: string[] = [];
    lines.push("=== Heap Snapshot Diff: Create 1K Rows ===");
    lines.push("");
    lines.push(
      `Total: +${totalCountDelta.toLocaleString()} objects, +${(totalSizeDelta / 1024).toFixed(0)} KB`,
    );
    lines.push("");
    lines.push(
      `${"Constructor".padEnd(50)} ${"Count Δ".padStart(10)} ${"Size Δ".padStart(12)} ${"Per Row".padStart(10)}`,
    );
    lines.push("─".repeat(85));

    // Show top 50 by count delta
    const top = diffs.filter((d) => d.countDelta > 0).slice(0, 50);
    for (const d of top) {
      const perRow = d.countDelta >= 100 ? (d.countDelta / 1000).toFixed(1) : "";
      lines.push(
        `${d.key.padEnd(50)} ${("+" + d.countDelta).padStart(10)} ${("+" + (d.sizeDelta / 1024).toFixed(1) + " KB").padStart(12)} ${perRow.padStart(10)}`,
      );
    }

    lines.push("");
    lines.push("=== Allocations that scale with row count (>= 500 new objects) ===");
    lines.push("");
    const scaled = diffs.filter((d) => d.countDelta >= 500);
    let scaledTotal = 0;
    for (const d of scaled) {
      const perRow = (d.countDelta / 1000).toFixed(1);
      lines.push(
        `  ${d.key.padEnd(48)} +${d.countDelta.toLocaleString().padStart(6)} (${perRow}/row)  ${("+" + (d.sizeDelta / 1024).toFixed(1) + " KB").padStart(12)}`,
      );
      scaledTotal += d.sizeDelta;
    }
    lines.push(
      `\n  Scaled allocations total: +${(scaledTotal / 1024).toFixed(0)} KB of +${(totalSizeDelta / 1024).toFixed(0)} KB total`,
    );

    const output = lines.join("\n");
    console.log("\n" + output);
    writeFileSync(resolve(__dirname, "../heap-results.txt"), output + "\n");
  }, 120000);
});
