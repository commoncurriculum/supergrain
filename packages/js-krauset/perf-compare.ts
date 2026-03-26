import { readFileSync } from "fs";
import { resolve } from "path";

const dir = import.meta.dirname;
const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error("Usage: pnpm perf:compare <baseline-name> <compare-name>");
  console.error("  e.g. pnpm perf:compare main-baseline optimized");
  process.exit(1);
}

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
};

function fmtPct(base: number, comp: number): string {
  const pct = ((comp - base) / base) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

console.log(
  `\n${baselineName} (${baseline.runCount} runs) vs ${compareName} (${compare.runCount} runs)\n`,
);

const header =
  "Benchmark".padEnd(cols.name) +
  `${baselineName}`.padStart(cols.base) +
  `${compareName}`.padStart(cols.comp) +
  "diff".padStart(cols.diff);
const sep = "─".repeat(header.length);

console.log(header);
console.log(sep);

for (const name of names) {
  const bm = baseline.benchmarks[name].total.mean;
  const cm = compare.benchmarks[name].total.mean;
  console.log(
    name.padEnd(cols.name) +
      `${bm.toFixed(1)}ms`.padStart(cols.base) +
      `${cm.toFixed(1)}ms`.padStart(cols.comp) +
      fmtPct(bm, cm).padStart(cols.diff),
  );
}

console.log(sep);

const bt = baseline.totals.total.mean;
const ct = compare.totals.total.mean;
console.log(
  "TOTAL".padEnd(cols.name) +
    `${bt.toFixed(1)}ms`.padStart(cols.base) +
    `${ct.toFixed(1)}ms`.padStart(cols.comp) +
    fmtPct(bt, ct).padStart(cols.diff),
);
console.log();
