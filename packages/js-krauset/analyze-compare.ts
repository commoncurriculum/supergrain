import { readFileSync } from "fs";
import { resolve } from "path";

const sgDir = resolve(__dirname);
const rhDir = resolve(__dirname, "../js-krauset-react-hooks");

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

function getFuncTimes(dir: string, name: string) {
  const profile: Profile = JSON.parse(readFileSync(resolve(dir, name + ".cpuprofile"), "utf-8"));
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
  const totalUs = profile.endTime - profile.startTime;
  return { funcTime, totalUs };
}

function analyzeTrace(dir: string, name: string) {
  const raw = JSON.parse(readFileSync(resolve(dir, name + "-trace.json"), "utf-8"));
  const events = raw.traceEvents || raw;
  let layout = 0,
    style = 0,
    paint = 0,
    gc = 0;
  for (const e of events) {
    const dur = (e.dur || 0) / 1000;
    if (dur <= 0) continue;
    if (e.name === "Layout") layout += dur;
    if (e.name === "UpdateLayoutTree") style += dur;
    if (e.name === "Paint") paint += dur;
    if (e.name === "MajorGC" || e.name === "MinorGC") gc += dur;
  }
  return { layout, style, paint, gc };
}

// ─── Table 1: Side-by-side top functions ───
for (const name of benchmarks) {
  const sg = getFuncTimes(sgDir, name);
  const rh = getFuncTimes(rhDir, name);

  console.log(`\n${"═".repeat(90)}`);
  console.log(`${name} (weight: ${weights[name]})`);
  console.log(
    `  supergrain profile: ${(sg.totalUs / 1000).toFixed(0)}ms    react-hooks profile: ${(rh.totalUs / 1000).toFixed(0)}ms`,
  );
  console.log(`${"═".repeat(90)}`);

  // Merge all functions from both
  const allFuncs = new Set([...sg.funcTime.keys(), ...rh.funcTime.keys()]);
  const rows: { fn: string; sgMs: number; rhMs: number; diff: number }[] = [];
  for (const fn of allFuncs) {
    if (fn === "(idle)" || fn === "(program)") continue;
    const sgMs = (sg.funcTime.get(fn) || 0) / 1000;
    const rhMs = (rh.funcTime.get(fn) || 0) / 1000;
    if (sgMs > 0.5 || rhMs > 0.5) {
      rows.push({
        fn,
        sgMs: +sgMs.toFixed(1),
        rhMs: +rhMs.toFixed(1),
        diff: +(sgMs - rhMs).toFixed(1),
      });
    }
  }
  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  console.log(
    "  " +
      "Function".padEnd(50) +
      "SG (ms)".padStart(8) +
      "RH (ms)".padStart(8) +
      "Δ (ms)".padStart(8),
  );
  console.log("  " + "─".repeat(74));
  for (const r of rows) {
    const diffStr = r.diff > 0 ? `+${r.diff}` : `${r.diff}`;
    console.log(
      "  " +
        r.fn.padEnd(50) +
        String(r.sgMs).padStart(8) +
        String(r.rhMs).padStart(8) +
        diffStr.padStart(8),
    );
  }
}

// ─── Table 2: Trace comparison (layout, style, paint, gc) ───
console.log(`\n\n${"═".repeat(90)}`);
console.log("TRACE COMPARISON: Layout + Style + Paint + GC");
console.log(`${"═".repeat(90)}`);
console.log(
  "  " +
    "Benchmark".padEnd(16) +
    "SG Layout".padStart(10) +
    "RH Layout".padStart(10) +
    "SG Style".padStart(10) +
    "RH Style".padStart(10) +
    "SG Paint".padStart(10) +
    "RH Paint".padStart(10) +
    "SG GC".padStart(8) +
    "RH GC".padStart(8),
);
console.log("  " + "─".repeat(88));
for (const name of benchmarks) {
  const sg = analyzeTrace(sgDir, name);
  const rh = analyzeTrace(rhDir, name);
  console.log(
    "  " +
      name.padEnd(16) +
      sg.layout.toFixed(1).padStart(10) +
      rh.layout.toFixed(1).padStart(10) +
      sg.style.toFixed(1).padStart(10) +
      rh.style.toFixed(1).padStart(10) +
      sg.paint.toFixed(1).padStart(10) +
      rh.paint.toFixed(1).padStart(10) +
      sg.gc.toFixed(1).padStart(8) +
      rh.gc.toFixed(1).padStart(8),
  );
}

// ─── Table 3: Functions ONLY in supergrain (not in react-hooks) ───
console.log(`\n\n${"═".repeat(90)}`);
console.log("FUNCTIONS UNIQUE TO SUPERGRAIN (> 0.5ms in any benchmark)");
console.log(`${"═".repeat(90)}`);
console.log(
  "  " + "Function".padEnd(40) + benchmarks.map((b) => b.slice(0, 8).padStart(9)).join(""),
);
console.log("  " + "─".repeat(40 + benchmarks.length * 9));

const uniqueFuncs = new Set<string>();
for (const name of benchmarks) {
  const sg = getFuncTimes(sgDir, name);
  const rh = getFuncTimes(rhDir, name);
  for (const fn of sg.funcTime.keys()) {
    const sgMs = (sg.funcTime.get(fn) || 0) / 1000;
    const rhMs = (rh.funcTime.get(fn) || 0) / 1000;
    if (sgMs > 0.5 && rhMs < 0.1) uniqueFuncs.add(fn);
  }
}

for (const fn of [...uniqueFuncs].sort()) {
  const vals = benchmarks.map((name) => {
    const sg = getFuncTimes(sgDir, name);
    const ms = (sg.funcTime.get(fn) || 0) / 1000;
    return ms > 0.1 ? ms.toFixed(1) : "-";
  });
  console.log("  " + fn.padEnd(40) + vals.map((v) => v.padStart(9)).join(""));
}
