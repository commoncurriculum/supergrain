/**
 * Analyze a Chrome trace file to break down where time is spent
 * during partial update.
 *
 * Run: npx tsx src/analyze-trace.ts
 */
import { readFileSync } from "fs";
import { resolve } from "path";

const file = process.argv[2] || "partial-update-trace.json";
const tracePath = resolve(__dirname, "..", file);
const trace: any[] = JSON.parse(readFileSync(tracePath, "utf-8"));

// --- Find the click event that triggers the update ---

const clicks = trace.filter((e) => e.name === "EventDispatch" && e.args?.data?.type === "click");
if (clicks.length === 0) {
  console.log("No click events found in trace");
  process.exit(1);
}

const click = clicks[clicks.length - 1]; // last click = the measured one
const clickStart = click.ts;
const clickEnd = click.ts + (click.dur || 0);
const clickPid = click.pid;
const clickTid = click.tid;

console.log(`Click event: ${(click.dur! / 1000).toFixed(1)}ms`);
console.log(`  pid=${clickPid} tid=${clickTid}`);
console.log("");

// --- Collect all top-level timeline events on the main thread after the click ---

const window = 200_000; // 200ms window after click start (in microseconds)
const relevant = trace.filter(
  (e) =>
    e.pid === clickPid &&
    e.tid === clickTid &&
    e.ts >= clickStart &&
    e.ts <= clickStart + window &&
    e.dur !== undefined &&
    e.dur > 0,
);

// Group by category
const categories = new Map<string, { count: number; totalUs: number }>();
for (const e of relevant) {
  const key = e.name || "unknown";
  const prev = categories.get(key) || { count: 0, totalUs: 0 };
  categories.set(key, {
    count: prev.count + 1,
    totalUs: prev.totalUs + e.dur,
  });
}

console.log("All events on main thread within 200ms of click:");
console.log("─".repeat(65));
const sorted = [...categories.entries()].sort((a, b) => b[1].totalUs - a[1].totalUs);
for (const [name, stats] of sorted.slice(0, 30)) {
  console.log(
    `  ${name.padEnd(30)} count=${String(stats.count).padStart(5)}  total=${(stats.totalUs / 1000).toFixed(1).padStart(8)}ms`,
  );
}

// --- Break down the click handler itself ---

console.log("");
console.log("Within the click handler:");
console.log("─".repeat(65));

const withinClick = trace.filter(
  (e) =>
    e.pid === clickPid &&
    e.tid === clickTid &&
    e.ts >= clickStart &&
    e.ts <= clickEnd &&
    e.dur !== undefined &&
    e.dur > 0 &&
    e.name !== "EventDispatch",
);

const clickBreakdown = new Map<string, { count: number; totalUs: number }>();
for (const e of withinClick) {
  const key = e.name || "unknown";
  const prev = clickBreakdown.get(key) || { count: 0, totalUs: 0 };
  clickBreakdown.set(key, {
    count: prev.count + 1,
    totalUs: prev.totalUs + e.dur,
  });
}

const clickSorted = [...clickBreakdown.entries()].sort((a, b) => b[1].totalUs - a[1].totalUs);
for (const [name, stats] of clickSorted.slice(0, 20)) {
  console.log(
    `  ${name.padEnd(30)} count=${String(stats.count).padStart(5)}  total=${(stats.totalUs / 1000).toFixed(1).padStart(8)}ms`,
  );
}

// --- Look for Layout, Paint, and other post-click rendering ---

console.log("");
console.log("Layout/Paint/Composite after click:");
console.log("─".repeat(65));

const renderEvents = trace.filter(
  (e) =>
    e.pid === clickPid &&
    e.tid === clickTid &&
    e.ts >= clickStart &&
    e.ts <= clickStart + window &&
    e.dur !== undefined &&
    [
      "Layout",
      "UpdateLayoutTree",
      "Paint",
      "PrePaint",
      "Commit",
      "CompositeLayers",
      "HitTest",
    ].includes(e.name),
);

for (const e of renderEvents) {
  const offset = ((e.ts - clickStart) / 1000).toFixed(1);
  console.log(`  +${offset.padStart(6)}ms  ${e.name.padEnd(20)} ${(e.dur / 1000).toFixed(1)}ms`);
}

// --- Look for FunctionCall events to find React vs our code ---

console.log("");
console.log("FunctionCall breakdown (top 20 by duration):");
console.log("─".repeat(65));

const funcCalls = trace.filter(
  (e) =>
    e.pid === clickPid &&
    e.tid === clickTid &&
    e.ts >= clickStart &&
    e.ts <= clickStart + window &&
    e.name === "FunctionCall" &&
    e.dur !== undefined &&
    e.dur > 100, // only calls > 0.1ms
);

funcCalls.sort((a: any, b: any) => b.dur - a.dur);
for (const e of funcCalls.slice(0, 20)) {
  const offset = ((e.ts - clickStart) / 1000).toFixed(1);
  const url = e.args?.data?.url || "";
  const fn = e.args?.data?.functionName || "";
  const line = e.args?.data?.lineNumber || "";
  const loc = url ? `${url.split("/").pop()}:${line}` : "";
  console.log(
    `  +${offset.padStart(6)}ms  ${(e.dur / 1000).toFixed(1).padStart(6)}ms  ${fn || "(anonymous)"}  ${loc}`,
  );
}

// --- Summarize ---

console.log("");
console.log("Summary:");
console.log("─".repeat(65));

const layoutTotal = renderEvents
  .filter((e) => e.name === "Layout" || e.name === "UpdateLayoutTree")
  .reduce((sum, e) => sum + e.dur, 0);
const paintTotal = renderEvents
  .filter((e) => e.name === "Paint" || e.name === "PrePaint" || e.name === "Commit")
  .reduce((sum, e) => sum + e.dur, 0);
const scriptTotal = relevant
  .filter((e) => e.name === "FunctionCall" || e.name === "EventDispatch")
  .reduce((sum, e) => sum + e.dur, 0);

console.log(`  Script (JS):     ${(scriptTotal / 1000).toFixed(1)}ms`);
console.log(`  Layout:          ${(layoutTotal / 1000).toFixed(1)}ms`);
console.log(`  Paint/Composite: ${(paintTotal / 1000).toFixed(1)}ms`);
