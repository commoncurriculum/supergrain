import { readFileSync } from "fs";

// react-hooks benchmark numbers from the screenshot (official Krause results)
const reactHooks: Record<string, number> = {
  "create-1k": 40.6,
  "replace-1k": 48.2,
  "partial-update": 23.5,
  "select-row": 12.1,
  "swap-rows": 160.5,
  "remove-row": 19.2,
  "create-10k": 566.9,
  "append-1k": 46.4,
  "clear-rows": 25.2,
};

// supergrain numbers from the screenshot
const supergrain: Record<string, number> = {
  "create-1k": 47.9,
  "replace-1k": 53.2,
  "partial-update": 25.4,
  "select-row": 11.2,
  "swap-rows": 33.0,
  "remove-row": 25.2,
  "create-10k": 602.9,
  "append-1k": 53.1,
  "clear-rows": 29.5,
};

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

// ─── Table 1: The gap ───
console.log("━━━ SUPERGRAIN vs REACT-HOOKS: THE GAP ━━━\n");
console.log(
  "Benchmark".padEnd(16) +
    "react-hooks".padStart(12) +
    "supergrain".padStart(12) +
    "gap (ms)".padStart(10) +
    "gap (%)".padStart(10) +
    "weight".padStart(8) +
    "weighted gap".padStart(14),
);
console.log("─".repeat(82));

let totalWeightedGap = 0;
const gaps: Record<string, number> = {};

for (const name of Object.keys(reactHooks)) {
  const rh = reactHooks[name];
  const sg = supergrain[name];
  const gap = sg - rh;
  const pct = (gap / rh) * 100;
  const w = weights[name];
  const wGap = gap * w;
  totalWeightedGap += wGap;
  gaps[name] = gap;

  console.log(
    name.padEnd(16) +
      (rh + "ms").padStart(12) +
      (sg + "ms").padStart(12) +
      ((gap > 0 ? "+" : "") + gap.toFixed(1) + "ms").padStart(10) +
      ((gap > 0 ? "+" : "") + pct.toFixed(0) + "%").padStart(10) +
      String(w).padStart(8) +
      ((wGap > 0 ? "+" : "") + wGap.toFixed(1) + "ms").padStart(14),
  );
}
console.log("─".repeat(82));
console.log(
  "TOTAL WEIGHTED GAP:".padEnd(68) +
    (totalWeightedGap > 0 ? "+" : "") +
    totalWeightedGap.toFixed(1) +
    "ms",
);

// ─── Table 2: What supergrain adds per component vs react-hooks ───
console.log("\n\n━━━ WHAT SUPERGRAIN ADDS PER ROW COMPONENT ━━━\n");
console.log("react-hooks Row: memo(function) — 0 hooks, direct property access");
console.log("supergrain Row:  tracked(function) — adds:");
console.log("  Hook 1: useReducer        (forceUpdate trigger)");
console.log("  Hook 2: useRef            (store effect node + cleanup)");
console.log("  Hook 3: useEffect         (cleanup on unmount)");
console.log("  Hook 4: useMemo           (from useComputed — creates computed signal)");
console.log("  Hook 5: useContext         (from Store.useStore())");
console.log("  + alienEffect() creation  (alien-signals effect node)");
console.log("  + computed() creation     (alien-signals computed for isSelected)");
console.log("  + getCurrentSub/setCurrentSub per render");
console.log("  + Proxy trap on every property read (item.id, item.label)");
console.log("");
console.log("Per 1000 rows: 5000 extra hook slots + 1000 effects + 1000 computeds + proxy reads");

// ─── Table 3: Profile data mapped to the gap ───
console.log("\n\n━━━ PROFILE DATA: SUPERGRAIN-CAUSED OVERHEAD ━━━\n");
console.log(
  "These show up as 'React' or 'alien-signals' in profiles but are CAUSED by supergrain:\n",
);

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

function getFuncTimes(name: string) {
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
    const fn = nodeMap.get(nodeId)!.callFrame.functionName || "(anonymous)";
    funcTime.set(fn, (funcTime.get(fn) || 0) + time);
  }
  return funcTime;
}

// Functions that react-hooks does NOT have
const sgOnlyFuncs = [
  // tracked() overhead
  "Tracked", // the wrapper component itself
  // alien-signals
  "computedOper", // computed signal evaluation (useComputed)
  "link2", // signal dependency linking
  "propagate2", // signal propagation
  "checkDirty2", // dirty checking
  "updateComputed", // computed re-evaluation
  "updateSignal", // signal update
  "signalOper", // signal operations
  // supergrain proxy
  "get", // proxy get handler
  "getNode", // signal node lookup
  // tracked() hooks (React executes these but only because tracked() registers them)
  "commitPassiveUnmountEffectsInsideOfDeletedTree_begin", // useEffect cleanup
  "recursivelyTraversePassiveUnmountEffects", // traversing for cleanup
  "commitHookEffectListMount", // mounting effects
];

// Also: useStore shows up in profile
sgOnlyFuncs.push("useStore");

for (const name of Object.keys(reactHooks)) {
  const funcs = getFuncTimes(name);
  const gap = gaps[name];
  let sgOverhead = 0;
  const details: { fn: string; ms: number }[] = [];

  for (const fn of sgOnlyFuncs) {
    const ms = (funcs.get(fn) || 0) / 1000;
    if (ms >= 0.3) {
      details.push({ fn, ms: +ms.toFixed(1) });
      sgOverhead += ms;
    }
  }

  if (details.length > 0) {
    console.log(
      `${name} (gap: ${gap > 0 ? "+" : ""}${gap.toFixed(1)}ms, weight: ${weights[name]})`,
    );
    details.sort((a, b) => b.ms - a.ms);
    for (const { fn, ms } of details) {
      console.log(`  ${fn.padEnd(55)} ${ms}ms`);
    }
    console.log(`  ${"MEASURED supergrain overhead:".padEnd(55)} ${sgOverhead.toFixed(1)}ms`);
    console.log(`  ${"ACTUAL gap vs react-hooks:".padEnd(55)} ${gap.toFixed(1)}ms`);
    console.log("");
  }
}

// ─── Table 4: Per-component cost estimate ───
console.log("\n━━━ PER-COMPONENT COST ESTIMATE ━━━\n");
console.log("create-1k: 1000 new rows");
{
  const funcs = getFuncTimes("create-1k");
  const tracked = (funcs.get("Tracked") || 0) / 1000;
  const computedOper = (funcs.get("computedOper") || 0) / 1000;
  const get = (funcs.get("get") || 0) / 1000;
  const getNode = (funcs.get("getNode") || 0) / 1000;
  const useStore = (funcs.get("useStore") || 0) / 1000;
  const link2 = (funcs.get("link2") || 0) / 1000;
  const commitHook = (funcs.get("commitHookEffectListMount") || 0) / 1000;
  const total = tracked + computedOper + get + getNode + useStore + link2 + commitHook;

  console.log(
    `  Tracked wrapper:        ${tracked.toFixed(1)}ms (${((tracked / 1000) * 1000).toFixed(1)}µs/component)`,
  );
  console.log(
    `  computedOper:           ${computedOper.toFixed(1)}ms (${((computedOper / 1000) * 1000).toFixed(1)}µs/component)`,
  );
  console.log(
    `  proxy get handler:      ${get.toFixed(1)}ms (${((get / 1000) * 1000).toFixed(1)}µs/component)`,
  );
  console.log(
    `  getNode:                ${getNode.toFixed(1)}ms (${((getNode / 1000) * 1000).toFixed(1)}µs/component)`,
  );
  console.log(
    `  useStore (context):     ${useStore.toFixed(1)}ms (${((useStore / 1000) * 1000).toFixed(1)}µs/component)`,
  );
  console.log(
    `  link2 (signal linking): ${link2.toFixed(1)}ms (${((link2 / 1000) * 1000).toFixed(1)}µs/component)`,
  );
  console.log(
    `  commitHookEffects:      ${commitHook.toFixed(1)}ms (${((commitHook / 1000) * 1000).toFixed(1)}µs/component)`,
  );
  console.log(`  ─────────────────────────────────`);
  console.log(`  Total measured:         ${total.toFixed(1)}ms`);
  console.log(`  Actual gap:             ${gaps["create-1k"].toFixed(1)}ms`);
  console.log(`  Unmeasured (extra hooks, proxy overhead below sample threshold):`);
  console.log(`                          ${(gaps["create-1k"] - total).toFixed(1)}ms`);
}

// ─── Table 5: Where supergrain WINS ───
console.log("\n\n━━━ WHERE SUPERGRAIN WINS (and why) ━━━\n");
console.log("select-row:  supergrain 11.2ms vs react-hooks 12.1ms  → SG wins by 0.9ms");
console.log("  Why: useComputed firewall — only 2 rows re-render");
console.log("  react-hooks: App re-renders → 1000 createElement + 1000 memo checks → 2 re-render");
console.log(
  "  supergrain:  signal → 2 computeds flip → 2 forceUpdate → 2 re-render. No App render.\n",
);

console.log("swap-rows:   supergrain 33.0ms vs react-hooks 160.5ms → SG wins by 127.5ms");
console.log("  Why: O(1) DOM swap. No React re-render at all.");
console.log("  react-hooks: App re-renders → 1000 createElement → full keyed reconciliation");
console.log(
  "  supergrain:  alienEffect detects 2 changed indices → DOM node swap. Zero React work.\n",
);

// ─── Summary ───
console.log("\n━━━ SUMMARY ━━━\n");
console.log("The gap is NOT React internals or DOM — react-hooks uses the same React/DOM.");
console.log("The gap IS supergrain's per-component overhead:");
console.log("  • 5 hooks per Row vs 0 hooks (tracked: 3 + useComputed: 1 + useContext: 1)");
console.log("  • alienEffect + computed creation per Row");
console.log("  • Proxy get trap on every property read");
console.log("  • Signal graph linking overhead");
console.log("");
console.log("Reducing hooks per tracked() component is the #1 lever.");
console.log(
  "Going from 5 hooks/Row to 2 hooks/Row would eliminate 3000 hook operations for 1k rows.",
);
