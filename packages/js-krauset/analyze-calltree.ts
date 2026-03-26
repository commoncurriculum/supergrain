import { readFileSync } from "fs";

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

function analyze(name: string) {
  const profile: Profile = JSON.parse(readFileSync(name + ".cpuprofile", "utf-8"));
  const nodeMap = new Map<number, ProfileNode>();
  for (const n of profile.nodes) nodeMap.set(n.id, n);

  // Self time per node
  const selfTime = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    selfTime.set(
      profile.samples[i],
      (selfTime.get(profile.samples[i]) || 0) + profile.timeDeltas[i],
    );
  }

  // Compute total time (self + descendants) via bottom-up accumulation
  const totalTime = new Map<number, number>();
  function computeTotal(id: number): number {
    if (totalTime.has(id)) return totalTime.get(id)!;
    const node = nodeMap.get(id)!;
    let t = selfTime.get(id) || 0;
    for (const cid of node.children || []) {
      t += computeTotal(cid);
    }
    totalTime.set(id, t);
    return t;
  }
  for (const n of profile.nodes) computeTotal(n.id);

  // Aggregate self time by function name
  const funcSelf = new Map<string, number>();
  const funcTotal = new Map<string, number>();
  for (const [nid, time] of selfTime) {
    const fn = nodeMap.get(nid)!.callFrame.functionName || "(anonymous)";
    funcSelf.set(fn, (funcSelf.get(fn) || 0) + time);
  }
  // Total time: aggregate by function across all nodes with that name
  for (const n of profile.nodes) {
    const fn = n.callFrame.functionName || "(anonymous)";
    const t = totalTime.get(n.id) || 0;
    // Only count if this node is a "root" call (parent doesn't have same name)
    // This avoids double-counting recursive calls
    // Simple approximation: just use the max total time per function
    if (t > 0) {
      funcTotal.set(fn, (funcTotal.get(fn) || 0) + (selfTime.get(n.id) || 0));
    }
  }

  return { selfTime, totalTime, nodeMap, funcSelf, profile };
}

// ─── For each high-weight benchmark, find the call tree around hot functions ───

const benchmarks = [
  { name: "partial-update", weight: 1.0 },
  { name: "create-1k", weight: 0.64 },
  { name: "replace-1k", weight: 0.56 },
  { name: "append-1k", weight: 0.56 },
  { name: "remove-row", weight: 0.48 },
  { name: "clear-rows", weight: 0.42 },
  { name: "swap-rows", weight: 0.28 },
  { name: "create-10k", weight: 0.21 },
  { name: "select-row", weight: 0.14 },
];

// For each benchmark: show functions with >1ms self time, grouped by category
const categories: Record<string, string[]> = {
  "React render": [
    "beginWork",
    "completeWork",
    "completeUnitOfWork",
    "workLoopSync",
    "reconcileChildrenArray",
    "createFiberFromTypeAndProps",
    "placeSingleChild",
    "performUnitOfWork",
    "renderWithHooks",
    "mountReducer",
    "updateReducer",
    "mountRef",
    "mountEffect",
    "mountMemo",
    "popHostContext",
  ],
  "React commit": [
    "commitRoot",
    "commitHookEffectListMount",
    "commitPassiveUnmountEffectsInsideOfDeletedTree_begin",
    "recursivelyTraversePassiveUnmountEffects",
    "commitMutationEffects",
    "flushPassiveEffects",
    "flushSync",
  ],
  "React DOM": ["setProp", "setValueForKnownAttribute", "setTextContent", "getHostSibling"],
  "React events": [
    "dispatchDiscreteEvent",
    "SyntheticBaseEvent",
    "getActiveElementDeep",
    "batchedUpdates$1",
    "getListener",
    "prepareToReadContext",
    "propagateParentContextChanges",
  ],
  "alien-signals": [
    "computedOper",
    "link2",
    "propagate2",
    "checkDirty2",
    "updateComputed",
    "updateSignal",
    "signalOper",
  ],
  supergrain: ["Tracked", "useStore", "getNode", "get", "run"],
  "DOM native": ["removeChild", "appendChild", "createElement", "setAttribute", "after", "before"],
  GC: ["(garbage collector)"],
};

for (const { name, weight } of benchmarks) {
  const { funcSelf, profile } = analyze(name);
  const profileTotal = (profile.endTime - profile.startTime) / 1000;

  console.log(`\n${"═".repeat(70)}`);
  console.log(`${name} (weight: ${weight}, profile total: ${profileTotal.toFixed(0)}ms)`);
  console.log(`${"═".repeat(70)}`);

  for (const [catName, funcs] of Object.entries(categories)) {
    const items: { fn: string; ms: number }[] = [];
    for (const fn of funcs) {
      const us = funcSelf.get(fn) || 0;
      if (us > 500) {
        // > 0.5ms
        items.push({ fn, ms: +(us / 1000).toFixed(1) });
      }
    }
    if (items.length > 0) {
      const catTotal = items.reduce((s, i) => s + i.ms, 0);
      console.log(`  ${catName}: ${catTotal.toFixed(1)}ms`);
      for (const { fn, ms } of items.sort((a, b) => b.ms - a.ms)) {
        console.log(`    ${fn.padEnd(50)} ${ms}ms`);
      }
    }
  }
}

// ─── Special: analyze what happens during partial-update propagation ───
console.log(`\n${"═".repeat(70)}`);
console.log("PARTIAL-UPDATE: Signal propagation chain detail");
console.log(`${"═".repeat(70)}`);
{
  const { funcSelf } = analyze("partial-update");
  const signalFuncs = [
    "propagate2",
    "checkDirty2",
    "updateComputed",
    "computedOper",
    "signalOper",
    "updateSignal",
    "link2",
  ];
  let total = 0;
  for (const fn of signalFuncs) {
    const ms = (funcSelf.get(fn) || 0) / 1000;
    if (ms > 0.1) {
      console.log(`  ${fn.padEnd(30)} ${ms.toFixed(1)}ms`);
      total += ms;
    }
  }
  console.log(`  ${"TOTAL signals".padEnd(30)} ${total.toFixed(1)}ms`);
  console.log(`  (This is the cost of propagating 100 label changes through the reactive graph)`);
}

// ─── Special: what does React do during create-1k render phase? ───
console.log(`\n${"═".repeat(70)}`);
console.log("CREATE-1K: React work breakdown");
console.log(`${"═".repeat(70)}`);
{
  const { funcSelf } = analyze("create-1k");
  const allFuncs = [...funcSelf.entries()]
    .filter(([fn, us]) => us > 200) // > 0.2ms
    .sort((a, b) => b[1] - a[1])
    .map(([fn, us]) => ({ fn, ms: +(us / 1000).toFixed(1) }));

  for (const { fn, ms } of allFuncs) {
    if (fn === "(idle)" || fn === "(program)") continue;
    console.log(`  ${fn.padEnd(55)} ${ms}ms`);
  }
}

// ─── Special: what does React do during select-row? ───
console.log(`\n${"═".repeat(70)}`);
console.log("SELECT-ROW: Full breakdown (weight 0.14 but shows signal propagation cost)");
console.log(`${"═".repeat(70)}`);
{
  const { funcSelf } = analyze("select-row");
  const allFuncs = [...funcSelf.entries()]
    .filter(([fn, us]) => us > 200)
    .sort((a, b) => b[1] - a[1])
    .map(([fn, us]) => ({ fn, ms: +(us / 1000).toFixed(1) }));

  for (const { fn, ms } of allFuncs) {
    if (fn === "(idle)" || fn === "(program)") continue;
    console.log(`  ${fn.padEnd(55)} ${ms}ms`);
  }
}
