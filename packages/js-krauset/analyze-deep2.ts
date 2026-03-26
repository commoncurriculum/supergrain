import { readFileSync } from "fs";

const benchmarks = [
  "create-1k",
  "replace-1k",
  "partial-update",
  "select-row",
  "swap-rows",
  "remove-row",
  "create-10k",
  "append-1k",
  "clear-rows",
];
const weights: Record<string, number> = {
  "create-1k": 0.64,
  "replace-1k": 0.56,
  "partial-update": 1.0,
  "select-row": 0.14,
  "swap-rows": 0.28,
  "remove-row": 0.48,
  "create-10k": 0.21,
  "append-1k": 0.56,
  "clear-rows": 0.42,
};
const benchNames: Record<string, string> = {
  "create-1k": "create rows (1k)",
  "replace-1k": "replace all rows",
  "partial-update": "partial update (10th)",
  "select-row": "select row",
  "swap-rows": "swap rows",
  "remove-row": "remove row",
  "create-10k": "create many rows (10k)",
  "append-1k": "append rows (1k to 1k)",
  "clear-rows": "clear rows",
};

const stats = JSON.parse(readFileSync("perf-stats-branch.json", "utf-8"));

// ─── Trace analysis ───

function analyzeTrace(name: string) {
  const raw = JSON.parse(readFileSync(name + "-trace.json", "utf-8"));
  const events = raw.traceEvents || raw;
  let layoutMs = 0,
    styleMs = 0,
    paintMs = 0,
    gcMs = 0;
  let maxStyleElements = 0;
  const styleCounts: number[] = [];

  for (const e of events) {
    const dur = (e.dur || 0) / 1000;
    if (dur <= 0) continue;
    if (e.name === "Layout") layoutMs += dur;
    if (e.name === "UpdateLayoutTree") {
      styleMs += dur;
      if (e.args?.elementCount > 1) {
        styleCounts.push(e.args.elementCount);
        if (e.args.elementCount > maxStyleElements) maxStyleElements = e.args.elementCount;
      }
    }
    if (e.name === "Paint") paintMs += dur;
    if (e.name === "MajorGC" || e.name === "MinorGC") gcMs += dur;
  }
  return { layoutMs, styleMs, paintMs, gcMs, maxStyleElements, styleCounts };
}

// ─── CPU profile analysis ───

interface ProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
    scriptId: string;
  };
  hitCount: number;
  children?: number[];
}

interface Profile {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples: number[];
  timeDeltas: number[];
}

function getAppFunctions(name: string) {
  const profile: Profile = JSON.parse(readFileSync(name + ".cpuprofile", "utf-8"));
  const nodeMap = new Map<number, ProfileNode>();
  for (const n of profile.nodes) nodeMap.set(n.id, n);

  const selfTime = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    selfTime.set(
      profile.samples[i],
      (selfTime.get(profile.samples[i]) || 0) + profile.timeDeltas[i],
    );
  }

  const funcTime = new Map<string, number>();
  for (const [nodeId, time] of selfTime) {
    const node = nodeMap.get(nodeId)!;
    const fn = node.callFrame.functionName || "(anonymous)";
    funcTime.set(fn, (funcTime.get(fn) || 0) + time);
  }
  return funcTime;
}

// ─── Output ───

// TABLE 1: Layout + Style as % of measured total
console.log("━━━ LAYOUT + STYLE vs MEASURED TOTAL ━━━\n");
console.log(
  "Benchmark".padEnd(16) +
    "Total".padStart(8) +
    "Script".padStart(8) +
    "Paint".padStart(8) +
    "Other".padStart(8) +
    "Layout".padStart(8) +
    "Style".padStart(8) +
    "L+S".padStart(8) +
    "Weight".padStart(8),
);
console.log("─".repeat(80));

for (const name of benchmarks) {
  const t = analyzeTrace(name);
  const bn = benchNames[name];
  const total = stats.benchmarks[bn].total.median;
  const script = stats.benchmarks[bn].script.median;
  const paint = stats.benchmarks[bn].paint.median;
  const other = total - script - paint;
  console.log(
    name.padEnd(16) +
      total.toFixed(1).padStart(8) +
      script.toFixed(1).padStart(8) +
      paint.toFixed(1).padStart(8) +
      other.toFixed(1).padStart(8) +
      t.layoutMs.toFixed(1).padStart(8) +
      t.styleMs.toFixed(1).padStart(8) +
      (t.layoutMs + t.styleMs).toFixed(1).padStart(8) +
      String(weights[name]).padStart(8),
  );
}

// TABLE 2: Style recalc element counts
console.log("\n\n━━━ STYLE RECALCULATION ELEMENT COUNTS ━━━\n");
for (const name of benchmarks) {
  const t = analyzeTrace(name);
  if (t.styleCounts.length > 0) {
    console.log(
      "  " +
        name.padEnd(16) +
        "elements: " +
        t.styleCounts.join(", ") +
        "  (max: " +
        t.maxStyleElements +
        ")",
    );
  }
}

// TABLE 3: getHostSibling
console.log("\n\n━━━ getHostSibling SCALING ━━━\n");
for (const name of ["create-1k", "create-10k", "append-1k", "replace-1k"]) {
  const funcs = getAppFunctions(name);
  const ghs = (funcs.get("getHostSibling") || 0) / 1000;
  const bn = benchNames[name];
  const script = stats.benchmarks[bn].script.median;
  console.log(
    "  " +
      name.padEnd(16) +
      "getHostSibling: " +
      ghs.toFixed(1) +
      "ms" +
      "  (" +
      ((ghs / script) * 100).toFixed(0) +
      "% of " +
      script.toFixed(1) +
      "ms script)" +
      "  weighted: " +
      (ghs * weights[name]).toFixed(1) +
      "ms",
  );
}

// TABLE 4: clear-rows teardown breakdown
console.log("\n\n━━━ CLEAR ROWS TEARDOWN ━━━\n");
{
  const funcs = getAppFunctions("clear-rows");
  const bn = benchNames["clear-rows"];
  const script = stats.benchmarks[bn].script.median;
  const teardownFuncs = [
    "commitPassiveUnmountEffectsInsideOfDeletedTree_begin",
    "recursivelyTraversePassiveUnmountEffects",
    "removeChild",
    "setProp",
  ];
  let sum = 0;
  for (const fn of teardownFuncs) {
    const ms = (funcs.get(fn) || 0) / 1000;
    if (ms > 0) {
      console.log("  " + fn.padEnd(55) + ms.toFixed(1) + "ms");
      sum += ms;
    }
  }
  console.log(
    "  " + "sum".padEnd(55) + sum.toFixed(1) + "ms of " + script.toFixed(1) + "ms script",
  );
  console.log(
    "  weighted impact of effect cleanup (7.5ms × 0.42): " + (7.5 * 0.42).toFixed(1) + "ms",
  );
}

// TABLE 5: computedOper across benchmarks
console.log("\n\n━━━ computedOper (useComputed evaluation) ━━━\n");
for (const name of benchmarks) {
  const funcs = getAppFunctions(name);
  const ms = (funcs.get("computedOper") || 0) / 1000;
  if (ms >= 0.5) {
    const bn = benchNames[name];
    const script = stats.benchmarks[bn].script.median;
    console.log(
      "  " +
        name.padEnd(16) +
        ms.toFixed(1) +
        "ms" +
        "  (" +
        ((ms / script) * 100).toFixed(0) +
        "% of script)" +
        "  weighted: " +
        (ms * weights[name]).toFixed(1) +
        "ms",
    );
  }
}

// TABLE 6: Weighted impact summary
console.log("\n\n━━━ BIGGEST WEIGHTED OPPORTUNITIES ━━━\n");

const opportunities: { name: string; weightedMs: number; detail: string }[] = [];

// getHostSibling in create-10k
{
  const funcs = getAppFunctions("create-10k");
  const ms = (funcs.get("getHostSibling") || 0) / 1000;
  opportunities.push({
    name: "getHostSibling (create-10k)",
    weightedMs: ms * 0.21,
    detail: ms.toFixed(1) + "ms × 0.21 weight, O(n²) scaling",
  });
}

// Effect cleanup in clear-rows
{
  const funcs = getAppFunctions("clear-rows");
  const ms = (funcs.get("commitPassiveUnmountEffectsInsideOfDeletedTree_begin") || 0) / 1000;
  opportunities.push({
    name: "effect cleanup (clear-rows)",
    weightedMs: ms * 0.42,
    detail: ms.toFixed(1) + "ms × 0.42 weight, 1000 useEffect teardowns",
  });
}

// Layout+style across all
for (const name of benchmarks) {
  const t = analyzeTrace(name);
  const ls = t.layoutMs + t.styleMs;
  if (ls > 5) {
    opportunities.push({
      name: "layout+style (" + name + ")",
      weightedMs: ls * weights[name],
      detail: ls.toFixed(1) + "ms × " + weights[name] + " weight",
    });
  }
}

// computedOper across all
let totalComputedWeighted = 0;
for (const name of benchmarks) {
  const funcs = getAppFunctions(name);
  const ms = (funcs.get("computedOper") || 0) / 1000;
  totalComputedWeighted += ms * weights[name];
}
opportunities.push({
  name: "computedOper (all benchmarks)",
  weightedMs: totalComputedWeighted,
  detail: "useComputed evaluation across all benchmarks",
});

// Sort by weighted impact
opportunities.sort((a, b) => b.weightedMs - a.weightedMs);
for (const o of opportunities) {
  console.log(
    "  " + (o.weightedMs.toFixed(1) + "ms").padStart(8) + "  " + o.name.padEnd(35) + o.detail,
  );
}
