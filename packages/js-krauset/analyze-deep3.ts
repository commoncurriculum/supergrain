import { readFileSync } from "fs";

// Understand: where does Layout+Style fall in the benchmark's measurement?
// The benchmark measures "script" and "paint" from trace events.
// Are Layout+Style inside "paint" or in the gap?

const benchmarks = ["create-1k", "swap-rows", "partial-update", "append-1k", "clear-rows"];

for (const name of benchmarks) {
  const raw = JSON.parse(readFileSync(name + "-trace.json", "utf-8"));
  const events = (raw.traceEvents || raw) as any[];

  // Find the timeline of key events
  const timeline: { name: string; start: number; end: number; dur: number }[] = [];

  for (const e of events) {
    const dur = (e.dur || 0) / 1000;
    if (dur <= 0.01) continue;
    const start = e.ts / 1000; // µs → ms
    const end = start + dur;

    if (
      [
        "Layout",
        "UpdateLayoutTree",
        "Paint",
        "FunctionCall",
        "EvaluateScript",
        "CompositeLayers",
        "MajorGC",
        "MinorGC",
      ].includes(e.name)
    ) {
      if (dur > 0.5) {
        // only events > 0.5ms
        timeline.push({ name: e.name, start, end, dur });
      }
    }
  }

  // Sort by start time
  timeline.sort((a, b) => a.start - b.start);

  console.log(`\n━━━ ${name} TIMELINE (events > 0.5ms) ━━━`);
  if (timeline.length > 0) {
    const origin = timeline[0].start;
    for (const t of timeline.slice(0, 25)) {
      const offset = t.start - origin;
      console.log(
        `  +${offset.toFixed(1).padStart(8)}ms  ${t.name.padEnd(20)}  ${t.dur.toFixed(1)}ms`,
      );
    }
  }
}

// Also: swap-rows style recalc — WHY 1017 elements for 2-row swap?
console.log("\n\n━━━ SWAP-ROWS: Style Recalc Detail ━━━\n");
{
  const raw = JSON.parse(readFileSync("swap-rows-trace.json", "utf-8"));
  const events = (raw.traceEvents || raw) as any[];
  for (const e of events) {
    if (e.name === "UpdateLayoutTree" && e.args?.elementCount > 1) {
      console.log(
        "  elementCount: " +
          e.args.elementCount +
          "  dur: " +
          ((e.dur || 0) / 1000).toFixed(1) +
          "ms",
      );
      if (e.args?.beginData) console.log("  beginData:", JSON.stringify(e.args.beginData));
    }
    if (e.name === "Layout" && (e.dur || 0) / 1000 > 0.1) {
      console.log("  Layout dur: " + ((e.dur || 0) / 1000).toFixed(1) + "ms");
      if (e.args?.beginData) console.log("  Layout beginData:", JSON.stringify(e.args.beginData));
    }
  }
}

// Compare: what % of total time is Layout+Style in the ACTUAL benchmark measurement?
// If L+S is inside what Krause measures as "total" then reducing it helps.
// Let's check by looking at trace event ordering.
console.log("\n\n━━━ CREATE-1K: Event ordering to determine measurement windows ━━━\n");
{
  const raw = JSON.parse(readFileSync("create-1k-trace.json", "utf-8"));
  const events = (raw.traceEvents || raw) as any[];

  // Find: when does FunctionCall (script) end? When does Paint happen?
  // Layout and StyleRecalc happen BETWEEN script end and paint start.
  let lastScriptEnd = 0;
  let firstLayoutStart = Infinity;
  let lastPaintEnd = 0;

  for (const e of events) {
    const start = e.ts / 1000;
    const dur = (e.dur || 0) / 1000;
    const end = start + dur;

    if (e.name === "FunctionCall" && dur > 1) {
      if (end > lastScriptEnd) lastScriptEnd = end;
    }
    if (e.name === "Layout" && dur > 1) {
      if (start < firstLayoutStart) firstLayoutStart = start;
    }
    if (e.name === "Paint") {
      if (end > lastPaintEnd) lastPaintEnd = end;
    }
  }

  const origin = lastScriptEnd;
  console.log("  Script ends at:     +0ms (reference)");
  console.log("  Layout starts at:   +" + (firstLayoutStart - origin).toFixed(1) + "ms");
  console.log("  Last paint ends at: +" + (lastPaintEnd - origin).toFixed(1) + "ms");
  console.log("  → Layout+Style+Paint all happen AFTER script, in the measured window");
}
