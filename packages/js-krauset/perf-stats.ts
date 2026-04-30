import { execSync } from "child_process";
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const name = process.argv[2];
const runCount = parseInt(process.argv[3] || "15", 10);
// --trim N: drop N lowest and N highest values per metric before computing
// stats. Requires runCount > 2*N. Default 0 (no trimming).
const trimArg = process.argv.indexOf("--trim");
const trimCount = trimArg !== -1 ? parseInt(process.argv[trimArg + 1] || "0", 10) : 0;

if (!name) {
  console.error("Usage: pnpm perf:stats <name> [runs] [--trim N]");
  console.error("  e.g. pnpm perf:stats baseline 20 --trim 3");
  process.exit(1);
}

if (trimCount > 0 && runCount <= 2 * trimCount) {
  console.error(`Error: runCount (${runCount}) must be greater than 2*trim (${2 * trimCount})`);
  process.exit(1);
}

const dir = __dirname;

// Note existing files so we only use the ones we create
const existingFiles = new Set(
  readdirSync(dir).filter((f) => f.match(/^perf-results-\d{4}-.+\.json$/)),
);

for (let i = 0; i < runCount; i++) {
  console.log(`\n=== Run ${i + 1}/${runCount} ===\n`);
  execSync("pnpm test:perf", { cwd: dir, stdio: "inherit" });
}

const newFiles = readdirSync(dir)
  .filter((f) => f.match(/^perf-results-\d{4}-.+\.json$/) && !existingFiles.has(f))
  .sort();

if (newFiles.length === 0) {
  console.error("No new result files generated.");
  process.exit(1);
}

console.log(`\nCollected ${newFiles.length} result files`);

const runs = newFiles.map((f) => JSON.parse(readFileSync(resolve(dir, f), "utf-8")));

const numericKeys = [
  "total",
  "script",
  "paint",
  "layouts",
  "numberCommits",
  "maxDeltaBetweenCommits",
  "rafLongDelay",
  "heapUsedDelta",
  "heapTotalDelta",
  "domNodesDelta",
];

function stats(values: number[], trim = 0) {
  let trimmed = values;
  if (trim > 0) {
    const sorted = [...values].sort((a, b) => a - b);
    trimmed = sorted.slice(trim, sorted.length - trim);
  }
  const sorted = [...trimmed].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = trimmed.reduce((s, v) => s + v, 0) / n;
  const median = n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const stddev = Math.sqrt(trimmed.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return { mean, median, stddev, min: sorted[0], max: sorted[n - 1] };
}

const benchmarkNames = runs[0].results.map((r: any) => r.name);

const output: any = {
  name,
  runCount: newFiles.length,
  trimCount,
  effectiveN: newFiles.length - 2 * trimCount,
  files: newFiles,
  git: runs[0].git,
  benchmarks: {} as any,
};

for (const benchName of benchmarkNames) {
  const samples = runs.map((run: any) => run.results.find((r: any) => r.name === benchName));
  const benchmark: any = {};
  for (const key of numericKeys) {
    benchmark[key] = stats(
      samples.map((s: any) => s[key]),
      trimCount,
    );
  }
  output.benchmarks[benchName] = benchmark;
}

const totalSamples = runs.map((run: any) => run.totals);
output.totals = {} as any;
for (const key of numericKeys.filter((k) => k in runs[0].totals)) {
  output.totals[key] = stats(
    totalSamples.map((t: any) => t[key]),
    trimCount,
  );
}

const outPath = resolve(dir, `perf-stats-${name}.json`);
writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
console.log(`\nStats written to ${outPath}`);
