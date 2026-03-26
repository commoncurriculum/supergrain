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

// ─── Part 1: CPU Profile Analysis ───

interface ProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
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

function categorize(funcName: string, url: string): string {
  // Native / browser
  if (!url) {
    if (funcName === "(idle)") return "idle";
    if (funcName === "(program)") return "browser-program";
    if (funcName === "(garbage collector)") return "gc";

    // DOM API
    const domFuncs = [
      "removeChild",
      "appendChild",
      "createElement",
      "setAttribute",
      "after",
      "before",
      "append",
      "insertBefore",
      "raf",
      "queueMicrotask",
    ];
    if (domFuncs.some((d) => funcName.includes(d))) return "dom-api";

    // Test harness (Playwright/CDP selectors)
    const harnessFuncs = [
      "matches",
      "query",
      "querySelector",
      "querySelectorAll",
      "evaluate",
      "elementFromPoint",
      "elementsFromPoint",
      "markTargetElements",
      "setupHitTargetInterceptor",
      "checkElementStates",
      "parentElementOrShadowHost",
      "isNativelyDisabled",
      "_matches",
      "_cached",
      "SelectorEvaluator",
      "innerSerialize",
      "jsonValue",
      "parseEvaluation",
      "InjectedScript",
      "previewNode",
      "oneLine",
      "elementSafeTagName",
      "dispatchEvent",
    ];
    if (harnessFuncs.some((h) => funcName.includes(h))) return "test-harness";

    return "native-other";
  }

  // App code (served over http)
  if (url.includes("http")) {
    // React internals
    const reactFuncs = [
      "completeWork",
      "beginWork",
      "completeUnitOfWork",
      "workLoopSync",
      "reconcileChild",
      "createFiber",
      "placeSingleChild",
      "popHostContext",
      "commitRoot",
      "commitHookEffect",
      "commitPassive",
      "commitMutationEffects",
      "commitDeletion",
      "recursivelyTraverse",
      "batchedUpdates",
      "getHostSibling",
      "setProp",
      "setValueFor",
      "setTextContent",
      "dispatchDiscreteEvent",
      "SyntheticBaseEvent",
      "getActiveElement",
      "prepareToRead",
      "propagateParentContext",
      "getListener",
      "run$1",
      "flushPassive",
      "flushSync",
      "processRootSchedule",
      "performWorkOnRoot",
      "scheduleUpdateOnFiber",
      "mountReducer",
      "updateReducer",
      "renderWithHooks",
      "mountRef",
      "mountEffect",
      "mountMemo",
    ];
    if (reactFuncs.some((r) => funcName.includes(r))) return "react";

    // alien-signals
    const alienFuncs = [
      "computedOper",
      "link2",
      "propagate2",
      "checkDirty2",
      "updateComputed",
      "updateSignal",
      "signalOper",
    ];
    if (alienFuncs.some((a) => funcName === a || funcName.includes(a))) return "alien-signals";

    // Supergrain
    const sgFuncs = ["Tracked", "useStore", "getNode", "get", "run"];
    if (funcName === "Tracked") return "supergrain";
    if (funcName === "useStore") return "supergrain";
    if (funcName === "getNode") return "supergrain";
    if (funcName === "get" && !funcName.includes("getHost")) return "supergrain";

    return "app-other";
  }

  return "other";
}

function analyzeCpuProfile(name: string) {
  const profile: Profile = JSON.parse(readFileSync(`${name}.cpuprofile`, "utf-8"));

  const nodeMap = new Map<number, ProfileNode>();
  for (const n of profile.nodes) nodeMap.set(n.id, n);

  // Self time per node
  const selfTime = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    const nid = profile.samples[i];
    selfTime.set(nid, (selfTime.get(nid) || 0) + profile.timeDeltas[i]);
  }

  // Bucket by category
  const buckets: Record<string, number> = {};
  // Also track individual functions within each category
  const funcDetail: Record<string, Record<string, number>> = {};
  let total = 0;

  for (const [nodeId, time] of selfTime) {
    const node = nodeMap.get(nodeId)!;
    const cat = categorize(node.callFrame.functionName, node.callFrame.url);
    buckets[cat] = (buckets[cat] || 0) + time;
    total += time;

    if (!funcDetail[cat]) funcDetail[cat] = {};
    const fn = node.callFrame.functionName || "(anonymous)";
    funcDetail[cat][fn] = (funcDetail[cat][fn] || 0) + time;
  }

  return { buckets, funcDetail, total };
}

// ─── Part 2: Trace File Analysis ───

interface TraceEvent {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  args?: any;
}

function analyzeTrace(name: string) {
  const raw = JSON.parse(readFileSync(`${name}-trace.json`, "utf-8"));
  const events: TraceEvent[] = raw.traceEvents || raw;

  let layoutTime = 0;
  let paintTime = 0;
  let styleRecalcTime = 0;
  let compositingTime = 0;
  let gcTime = 0;
  let forcedReflows = 0;
  let layoutCount = 0;
  let paintCount = 0;
  let styleRecalcCount = 0;
  let maxLayoutElements = 0;
  let maxStyleElements = 0;

  for (const e of events) {
    const dur = (e.dur || 0) / 1000; // µs → ms
    if (dur <= 0) continue;

    switch (e.name) {
      case "Layout":
        layoutTime += dur;
        layoutCount++;
        if (e.args?.beginData?.dirtyObjects > maxLayoutElements)
          maxLayoutElements = e.args.beginData.dirtyObjects;
        break;
      case "Paint":
        paintTime += dur;
        paintCount++;
        break;
      case "UpdateLayoutTree":
        styleRecalcTime += dur;
        styleRecalcCount++;
        if (e.args?.elementCount > maxStyleElements) maxStyleElements = e.args.elementCount;
        break;
      case "CompositeLayers":
        compositingTime += dur;
        break;
      case "MajorGC":
      case "MinorGC":
        gcTime += dur;
        break;
      case "ForcedReflow":
        forcedReflows++;
        break;
    }
  }

  return {
    layoutMs: +layoutTime.toFixed(2),
    layoutCount,
    maxLayoutElements,
    paintMs: +paintTime.toFixed(2),
    paintCount,
    styleRecalcMs: +styleRecalcTime.toFixed(2),
    styleRecalcCount,
    maxStyleElements,
    compositingMs: +compositingTime.toFixed(2),
    gcMs: +gcTime.toFixed(2),
    forcedReflows,
  };
}

// ─── Part 3: Top React functions per benchmark ───

function getTopReactFunctions(name: string) {
  const profile: Profile = JSON.parse(readFileSync(`${name}.cpuprofile`, "utf-8"));

  const nodeMap = new Map<number, ProfileNode>();
  for (const n of profile.nodes) nodeMap.set(n.id, n);

  const selfTime = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    const nid = profile.samples[i];
    selfTime.set(nid, (selfTime.get(nid) || 0) + profile.timeDeltas[i]);
  }

  const funcTime = new Map<string, number>();
  for (const [nodeId, time] of selfTime) {
    const node = nodeMap.get(nodeId)!;
    const url = node.callFrame.url;
    if (!url || !url.includes("http")) continue; // only app/react code
    const fn = node.callFrame.functionName || "(anonymous)";
    funcTime.set(fn, (funcTime.get(fn) || 0) + time);
  }

  return [...funcTime.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([fn, time]) => ({ fn, ms: +(time / 1000).toFixed(1) }));
}

// ─── Output ───

console.log("╔══════════════════════════════════════════════════════════════════╗");
console.log("║              DEEP PERFORMANCE ANALYSIS                         ║");
console.log("╚══════════════════════════════════════════════════════════════════╝\n");

// Table 1: CPU time by category
console.log("━━━ TABLE 1: CPU TIME BY CATEGORY (ms) ━━━\n");
const header =
  "Benchmark".padEnd(16) +
  "React".padStart(8) +
  "Signals".padStart(8) +
  "SG".padStart(8) +
  "DOM API".padStart(8) +
  "GC".padStart(8) +
  "Harness".padStart(8) +
  "Browser".padStart(8) +
  "Idle".padStart(8) +
  "TOTAL".padStart(8);
console.log(header);
console.log("─".repeat(header.length));

for (const name of benchmarks) {
  const { buckets, total } = analyzeCpuProfile(name);
  const ms = (k: string) => +((buckets[k] || 0) / 1000).toFixed(1);
  console.log(
    name.padEnd(16) +
      String(ms("react")).padStart(8) +
      String(ms("alien-signals")).padStart(8) +
      String(ms("supergrain")).padStart(8) +
      String(ms("dom-api")).padStart(8) +
      String(ms("gc")).padStart(8) +
      String(ms("test-harness")).padStart(8) +
      String(ms("browser-program")).padStart(8) +
      String(ms("idle")).padStart(8) +
      String(+(total / 1000).toFixed(1)).padStart(8),
  );
}

// Table 2: Trace-based layout/paint/style timing
console.log("\n\n━━━ TABLE 2: BROWSER RENDERING (from traces, ms) ━━━\n");
const header2 =
  "Benchmark".padEnd(16) +
  "Layout".padStart(8) +
  "#Lay".padStart(6) +
  "MaxElm".padStart(8) +
  "StyleRc".padStart(8) +
  "#Sty".padStart(6) +
  "MaxElm".padStart(8) +
  "Paint".padStart(8) +
  "Comp".padStart(8) +
  "GC".padStart(8) +
  "ForcRfl".padStart(8);
console.log(header2);
console.log("─".repeat(header2.length));

for (const name of benchmarks) {
  const t = analyzeTrace(name);
  console.log(
    name.padEnd(16) +
      String(t.layoutMs).padStart(8) +
      String(t.layoutCount).padStart(6) +
      String(t.maxLayoutElements).padStart(8) +
      String(t.styleRecalcMs).padStart(8) +
      String(t.styleRecalcCount).padStart(6) +
      String(t.maxStyleElements).padStart(8) +
      String(t.paintMs).padStart(8) +
      String(t.compositingMs).padStart(8) +
      String(t.gcMs).padStart(8) +
      String(t.forcedReflows).padStart(8),
  );
}

// Table 3: Top React/app functions per high-weight benchmark
console.log("\n\n━━━ TABLE 3: TOP APP FUNCTIONS BY BENCHMARK ━━━\n");
for (const name of benchmarks) {
  const topFns = getTopReactFunctions(name);
  console.log(`\n${name} (weight: ${weights[name]})`);
  for (const { fn, ms } of topFns) {
    if (ms < 0.5) continue;
    console.log(`  ${String(ms + "ms").padStart(8)}  ${fn}`);
  }
}

// Table 4: getHostSibling scaling analysis
console.log("\n\n━━━ TABLE 4: getHostSibling SCALING ━━━\n");
for (const name of ["create-1k", "create-10k", "append-1k", "replace-1k"]) {
  const topFns = getTopReactFunctions(name);
  const ghs = topFns.find((f) => f.fn === "getHostSibling");
  console.log(`${name.padEnd(16)} getHostSibling: ${ghs ? ghs.ms + "ms" : "< 0.5ms"}`);
}

// Table 5: Weighted impact analysis
console.log("\n\n━━━ TABLE 5: WEIGHTED TIME BREAKDOWN ━━━\n");
console.log(
  "Benchmark".padEnd(16) +
    "Weight".padStart(8) +
    "React".padStart(10) +
    "Signals".padStart(10) +
    "DomAPI".padStart(10) +
    "GC".padStart(10) +
    "Weighted".padStart(10),
);
console.log("─".repeat(74));

let totalWeightedReact = 0;
let totalWeightedSignals = 0;
let totalWeightedDom = 0;
let totalWeightedGc = 0;

for (const name of benchmarks) {
  const { buckets } = analyzeCpuProfile(name);
  const w = weights[name];
  const ms = (k: string) => +((buckets[k] || 0) / 1000).toFixed(1);
  const reactW = ms("react") * w;
  const sigW = ms("alien-signals") * w;
  const domW = ms("dom-api") * w;
  const gcW = ms("gc") * w;
  totalWeightedReact += reactW;
  totalWeightedSignals += sigW;
  totalWeightedDom += domW;
  totalWeightedGc += gcW;

  console.log(
    name.padEnd(16) +
      String(w).padStart(8) +
      (ms("react") + "ms").padStart(10) +
      (ms("alien-signals") + "ms").padStart(10) +
      (ms("dom-api") + "ms").padStart(10) +
      (ms("gc") + "ms").padStart(10) +
      (+(reactW + sigW + domW + gcW).toFixed(1) + "ms").padStart(10),
  );
}
console.log("─".repeat(74));
console.log(
  "WEIGHTED TOTAL".padEnd(16) +
    "".padStart(8) +
    (totalWeightedReact.toFixed(1) + "ms").padStart(10) +
    (totalWeightedSignals.toFixed(1) + "ms").padStart(10) +
    (totalWeightedDom.toFixed(1) + "ms").padStart(10) +
    (totalWeightedGc.toFixed(1) + "ms").padStart(10) +
    (
      (totalWeightedReact + totalWeightedSignals + totalWeightedDom + totalWeightedGc).toFixed(1) +
      "ms"
    ).padStart(10),
);
