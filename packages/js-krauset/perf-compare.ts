import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = __dirname;
const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error("Usage: pnpm perf:compare <baseline-name> <compare-name>");
  console.error("  e.g. pnpm perf:compare main-baseline optimized");
  process.exit(1);
}

// Krause benchmark weights (from js-framework-benchmark scoring)
// Maps our benchmark names to their weights
const weights: Record<string, number> = {
  "create rows (1k)": 0.64,
  "replace all rows": 0.56,
  "partial update (10th)": 0.56,
  "select row": 0.19,
  "swap rows": 0.13,
  "remove row": 0.53,
  "create many rows (10k)": 0.56,
  "append rows (1k to 1k)": 0.55,
  "clear rows": 0.42,
};

const [baselineName, compareName] = args;
const baselinePath = resolve(dir, `perf-stats-${baselineName}.json`);
const comparePath = resolve(dir, `perf-stats-${compareName}.json`);

const baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
const compare = JSON.parse(readFileSync(comparePath, "utf-8"));

const names = Object.keys(baseline.benchmarks);

const cols = {
  name: 28,
  base: 12,
  comp: 14,
  diff: 10,
  weight: 8,
  weighted: 10,
};

function fmtPct(base: number, comp: number): string {
  const pct = ((comp - base) / base) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

console.log(
  `\n${baselineName} (${baseline.runCount} runs, n=${baseline.effectiveN ?? baseline.runCount}) vs ${compareName} (${compare.runCount} runs, n=${compare.effectiveN ?? compare.runCount})\n`,
);

const header =
  "Benchmark".padEnd(cols.name) +
  `${baselineName}`.padStart(cols.base) +
  `${compareName}`.padStart(cols.comp) +
  "diff".padStart(cols.diff) +
  "weight".padStart(cols.weight) +
  "weighted".padStart(cols.weighted);
const sep = "─".repeat(header.length);

console.log(header);
console.log(sep);

let baseWeightedTotal = 0;
let compWeightedTotal = 0;

for (const name of names) {
  const bm = baseline.benchmarks[name].total.mean;
  const cm = compare.benchmarks[name].total.mean;
  const w = weights[name] ?? 1;
  baseWeightedTotal += bm * w;
  compWeightedTotal += cm * w;
  console.log(
    name.padEnd(cols.name) +
      `${bm.toFixed(1)}ms`.padStart(cols.base) +
      `${cm.toFixed(1)}ms`.padStart(cols.comp) +
      fmtPct(bm, cm).padStart(cols.diff) +
      `${w.toFixed(2)}`.padStart(cols.weight) +
      fmtPct(bm * w, cm * w).padStart(cols.weighted),
  );
}

console.log(sep);

const bt = baseline.totals.total.mean;
const ct = compare.totals.total.mean;
console.log(
  "TOTAL (unweighted)".padEnd(cols.name) +
    `${bt.toFixed(1)}ms`.padStart(cols.base) +
    `${ct.toFixed(1)}ms`.padStart(cols.comp) +
    fmtPct(bt, ct).padStart(cols.diff),
);

console.log(
  "TOTAL (weighted)".padEnd(cols.name) +
    `${baseWeightedTotal.toFixed(1)}`.padStart(cols.base) +
    `${compWeightedTotal.toFixed(1)}`.padStart(cols.comp) +
    fmtPct(baseWeightedTotal, compWeightedTotal).padStart(cols.diff),
);
console.log();
