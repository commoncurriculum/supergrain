import { readFileSync } from "fs";
import { resolve } from "path";

const sgDir = __dirname;
const rhDir = resolve(__dirname, "../js-krauset-react-hooks");

const sg = JSON.parse(readFileSync(resolve(sgDir, "perf-stats-supergrain.json"), "utf-8"));
const rh = JSON.parse(readFileSync(resolve(rhDir, "perf-stats-react-hooks.json"), "utf-8"));

const weights: Record<string, number> = {
  "create rows (1k)": 0.64,
  "replace all rows": 0.56,
  "partial update (10th)": 1.0,
  "select row": 0.14,
  "swap rows": 0.28,
  "remove row": 0.48,
  "create many rows (10k)": 0.21,
  "append rows (1k to 1k)": 0.56,
  "clear rows": 0.42,
};

const shortNames: Record<string, string> = {
  "create rows (1k)": "create-1k",
  "replace all rows": "replace-1k",
  "partial update (10th)": "partial-upd",
  "select row": "select",
  "swap rows": "swap",
  "remove row": "remove",
  "create many rows (10k)": "create-10k",
  "append rows (1k to 1k)": "append-1k",
  "clear rows": "clear",
};

// solid-store-v1.9.3 is the fastest in the screenshot — use as reference
// These are from the screenshot the user shared
const solidStore: Record<string, number> = {
  "create rows (1k)": 36.2,
  "replace all rows": 41.5,
  "partial update (10th)": 19.6,
  "select row": 6.1,
  "swap rows": 24.4,
  "remove row": 18.5,
  "create many rows (10k)": 393.6,
  "append rows (1k to 1k)": 44.7,
  "clear rows": 20.9,
};

// Compute geometric mean of slowdown ratios (how Krause ranks)
function geoMean(ratios: number[]): number {
  const logSum = ratios.reduce((s, r) => s + Math.log(r), 0);
  return Math.exp(logSum / ratios.length);
}

console.log("━━━ CURRENT STANDING (median total time, parallel n=15) ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "Fastest".padStart(8) +
    "SG".padStart(8) +
    "RH".padStart(8) +
    "SG/Fast".padStart(8) +
    "RH/Fast".padStart(8) +
    "Best of".padStart(10),
);
console.log("─".repeat(64));

const sgRatios: number[] = [];
const rhRatios: number[] = [];
const bestRatios: number[] = [];

for (const name of Object.keys(weights)) {
  const fast = solidStore[name];
  const sgT = sg.benchmarks[name].total.median;
  const rhT = rh.benchmarks[name].total.median;
  const sgR = sgT / fast;
  const rhR = rhT / fast;
  const bestT = Math.min(sgT, rhT);
  const bestR = bestT / fast;
  sgRatios.push(sgR);
  rhRatios.push(rhR);
  bestRatios.push(bestR);

  const winner = sgT < rhT ? "SG" : sgT > rhT ? "RH" : "tie";

  console.log(
    (shortNames[name] || name).padEnd(14) +
      fast.toFixed(1).padStart(8) +
      sgT.toFixed(1).padStart(8) +
      rhT.toFixed(1).padStart(8) +
      sgR.toFixed(2).padStart(8) +
      rhR.toFixed(2).padStart(8) +
      winner.padStart(10),
  );
}

console.log("─".repeat(64));
console.log(
  "Geo mean".padEnd(14) +
    "".padStart(8) +
    "".padStart(8) +
    "".padStart(8) +
    geoMean(sgRatios).toFixed(2).padStart(8) +
    geoMean(rhRatios).toFixed(2).padStart(8) +
    geoMean(bestRatios).toFixed(2).padStart(8) +
    " (ceiling)",
);

// ─── Ceiling analysis: what if SG matched RH on every benchmark it loses? ───
console.log("\n\n━━━ CEILING ANALYSIS ━━━\n");
console.log("If supergrain matched react-hooks on every benchmark it currently loses,");
console.log("while keeping its wins (swap, replace):\n");

const ceilingRatios: number[] = [];
const ceilingTimes: Record<string, number> = {};

for (const name of Object.keys(weights)) {
  const fast = solidStore[name];
  const sgT = sg.benchmarks[name].total.median;
  const rhT = rh.benchmarks[name].total.median;
  const ceilingT = Math.min(sgT, rhT); // take the better of the two
  ceilingTimes[name] = ceilingT;
  ceilingRatios.push(ceilingT / fast);
}

console.log(
  "Benchmark".padEnd(14) +
    "Current SG".padStart(12) +
    "Ceiling".padStart(10) +
    "Savings".padStart(10) +
    "Weight".padStart(8),
);
console.log("─".repeat(54));

let totalWeightedSavings = 0;
for (const name of Object.keys(weights)) {
  const sgT = sg.benchmarks[name].total.median;
  const cT = ceilingTimes[name];
  const savings = sgT - cT;
  const w = weights[name];
  totalWeightedSavings += savings * w;

  if (savings > 0.5) {
    console.log(
      (shortNames[name] || name).padEnd(14) +
        sgT.toFixed(1).padStart(12) +
        cT.toFixed(1).padStart(10) +
        ("-" + savings.toFixed(1)).padStart(10) +
        w.toFixed(2).padStart(8),
    );
  }
}

console.log("─".repeat(54));
console.log("Weighted total savings at ceiling: " + totalWeightedSavings.toFixed(1) + "ms");
console.log("\nCurrent SG geo mean:  " + geoMean(sgRatios).toFixed(3));
console.log("Ceiling geo mean:     " + geoMean(ceilingRatios).toFixed(3));
console.log("RH geo mean:          " + geoMean(rhRatios).toFixed(3));

// ─── What each idea could contribute toward the ceiling ───
console.log("\n\n━━━ IDEA IMPACT vs CEILING (total time, not script) ━━━\n");
console.log("Only benchmarks with statistically significant total-time gaps matter.\n");

// From the significance analysis: total time significant in BOTH rounds:
// swap: SG wins (keep)
// create-10k: SG loses by ~49-56ms total
// append-1k: SG loses by ~3.9-4.4ms total
// select: SG loses by ~2.3-3.0ms total
// Everything else: total time NOT significantly different

console.log("Statistically significant total-time losses (both measurement rounds):");
console.log("  create-10k:  +48.9ms (parallel) / +56.0ms (interleaved)  weight 0.21");
console.log("  append-1k:   +3.9ms  (parallel) / +4.4ms  (interleaved)  weight 0.56");
console.log("  select:      +2.3ms  (parallel) / +3.0ms  (interleaved)  weight 0.14");
console.log("");
console.log("Weighted total-time ceiling (significant losses only):");
const sigLosses = 48.9 * 0.21 + 3.9 * 0.56 + 2.3 * 0.14;
console.log("  " + sigLosses.toFixed(1) + "ms weighted");
console.log("");
console.log("NOT significant total-time differences (both rounds p > 0.05):");
console.log("  create-1k, replace-1k, partial-update, remove, clear");
console.log("  These benchmarks are effectively TIED between SG and RH on total time.");
console.log("  Script differences exist but are absorbed by paint/layout variance.");

// ─── For component overhead ───
console.log("\n\n━━━ FOR COMPONENT OVERHEAD ━━━\n");
console.log("For is tracked() itself — 3 hooks (useReducer + useRef + useEffect).");
console.log("Plus: swap detection layout effect subscribes to ALL N array indices.");
console.log("On every structural change (append, remove, clear), For:");
console.log("  1. Disposes old alienEffect (unsubscribes N index signals)");
console.log("  2. Creates new alienEffect (subscribes N+delta index signals)");
console.log("For append 1k→2k: 1000 unsubscribe + 2000 subscribe = 3000 signal ops.");
console.log("This is IN ADDITION to the per-Row overhead.");
