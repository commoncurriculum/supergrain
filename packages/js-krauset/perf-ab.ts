/**
 * Interleaved A/B benchmark runner.
 *
 * Takes two prebuilt `@supergrain/kernel` `dist/` directories and alternates
 * between them inside a single time window, running the existing perf suite
 * (`pnpm test:perf`) once per arm per pair. Nothing here measures anything: the
 * timing, warmup counts and CPU throttling all come from `src/perf.test.ts`.
 * This script only decides *when* each build runs and how the resulting numbers
 * are paired up.
 *
 * Why interleave instead of running one arm then the other: machine speed drifts
 * (thermal, noisy neighbours, CI runner contention) by more than the effects we
 * care about, so a block of A followed by a block of B confounds "the code got
 * faster" with "the machine got slower". Alternating means both arms see the
 * same drift, and comparing within a pair cancels it. The order flips every pair
 * so neither arm permanently occupies the warmer slot.
 *
 * Read the paired median delta and the win count, not the absolute milliseconds.
 *
 * Usage:
 *   node perf-ab.ts --control <dist-dir> --experiment <dist-dir> [--runs 10]
 *                   [--mode kernel|app] [--out report.md] [--json data.json]
 *                   [--label-control <text>] [--label-experiment <text>]
 *
 * --mode kernel (default): arms are prebuilt `packages/kernel/dist` dirs; the
 *   app is rebuilt from the current source every run. Isolates a kernel change.
 * --mode app: arms are prebuilt `packages/js-krauset/dist` bundles served
 *   as-is. Measures two complete builds against each other (used by PR CI).
 */
import { execSync } from "child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve } from "path";

// Explicit .ts extension: these root-level scripts run through Node's type
// stripping, which resolves ESM specifiers literally and won't guess it.
import { KRAUSE_WEIGHTS } from "./perf-weights.ts";

const dir = import.meta.dirname;
const kernelDist = resolve(dir, "../kernel/dist");
const latestJson = resolve(dir, "perf-results.json");

interface BenchResult {
  name: string;
  total: number;
  script: number;
  paint: number;
}

interface RunJson {
  timestamp: string;
  results: BenchResult[];
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1) {
    // A flag with a missing or flag-shaped value is a typo, not a request for
    // the default — silently substituting one would benchmark the wrong thing.
    const value = process.argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`--${name} requires a value`);
      process.exit(1);
    }
    return value;
  }
  if (fallback !== undefined) return fallback;
  console.error(`Missing required argument --${name}`);
  process.exit(1);
}

const controlDir = resolve(arg("control"));
const experimentDir = resolve(arg("experiment"));
// "kernel": arms are prebuilt kernel dists; the app is rebuilt from the current
// source for every run (isolates a kernel change — the local-experiment tool).
// "app": arms are prebuilt js-krauset dist bundles served as-is, no rebuild
// (measures two complete builds against each other — what PR CI wants, since a
// PR's win can live in the app as easily as in the kernel).
const mode = arg("mode", "kernel");
if (mode !== "kernel" && mode !== "app") {
  console.error(`--mode must be "kernel" or "app", got "${mode}"`);
  process.exit(1);
}
const runs = parseInt(arg("runs", "10"), 10);
const outPath = arg("out", resolve(dir, "perf-ab-report.md"));
const jsonPath = arg("json", resolve(dir, "perf-ab-data.json"));
const controlLabel = arg("label-control", "control");
const experimentLabel = arg("label-experiment", "PR");

for (const [label, path] of [
  ["control", controlDir],
  ["experiment", experimentDir],
] as const) {
  if (!existsSync(path)) {
    console.error(`--${label} directory does not exist: ${path}`);
    process.exit(1);
  }
}

if (!Number.isInteger(runs) || runs < 1) {
  console.error(`--runs must be a positive integer, got "${runs}"`);
  process.exit(1);
}

const appDist = resolve(dir, "dist");
const armTarget = mode === "kernel" ? kernelDist : appDist;

// Swapping arms overwrites a real build output. Without restoring it, whatever
// ran last silently *becomes* your `dist` — so a later `pnpm test` or a manual
// check would be reading a foreign build with no indication anything happened.
const backupDir = resolve(tmpdir(), `supergrain-perf-ab-${process.pid}`);
const hadExistingDist = existsSync(armTarget);
if (hadExistingDist) {
  cpSync(armTarget, backupDir, { recursive: true });
}

let restored = false;
function restoreDist(): void {
  if (restored) return;
  restored = true;
  rmSync(armTarget, { recursive: true, force: true });
  if (hadExistingDist) {
    cpSync(backupDir, armTarget, { recursive: true });
    rmSync(backupDir, { recursive: true, force: true });
  }
  console.log(`Restored ${armTarget} to its pre-run state.`);
}

process.on("exit", restoreDist);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    restoreDist();
    process.exit(1);
  });
}

/** Swap in one arm: prebuilt kernel dist (kernel mode) or app bundle (app mode). */
function useArm(from: string): void {
  rmSync(armTarget, { recursive: true, force: true });
  cpSync(from, armTarget, { recursive: true });
}

/**
 * Run the perf suite once and return its results.
 *
 * `test:perf` pipes vitest through `tee`, so a failing run still exits 0 and
 * leaves the *previous* run's `perf-results.json` in place. Comparing the
 * timestamp against the last one we saw turns that silent staleness into a hard
 * error — reusing a stale file would quietly compare a build against itself.
 */
let lastTimestamp = "";
function runOnce(): RunJson {
  // App mode serves the prebuilt bundle as-is; rebuilding would overwrite the
  // arm we just swapped in.
  const command =
    mode === "kernel"
      ? "pnpm test:perf"
      : "npx vitest run --config vitest.dist.config.ts src/perf.test.ts";
  execSync(command, { cwd: dir, stdio: "inherit", timeout: 20 * 60_000 });
  if (!existsSync(latestJson)) throw new Error("perf-results.json was not written");
  const json: RunJson = JSON.parse(readFileSync(latestJson, "utf-8"));
  if (json.timestamp === lastTimestamp) {
    throw new Error(
      `perf-results.json was not refreshed (timestamp ${json.timestamp}) — the perf run failed`,
    );
  }
  lastTimestamp = json.timestamp;
  return json;
}

interface Pair {
  control: RunJson;
  experiment: RunJson;
}

const pairs: Pair[] = [];

for (let i = 0; i < runs; i++) {
  // Flip which arm goes first each pair so neither one always runs on a
  // machine that has just been idle (or has just been hammered).
  const controlFirst = i % 2 === 0;
  const order = controlFirst ? ["control", "experiment"] : ["experiment", "control"];
  console.log(`\n=== Pair ${i + 1}/${runs} (${order.join(" then ")}) ===\n`);

  const pair: Partial<Pair> = {};
  for (const armName of order) {
    console.log(`\n--- pair ${i + 1}: ${armName} ---\n`);
    const isControl = armName === "control";
    useArm(isControl ? controlDir : experimentDir);
    const run = runOnce();
    if (isControl) pair.control = run;
    else pair.experiment = run;
  }
  pairs.push(pair as Pair);
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function binomCoef(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/**
 * Exact two-sided sign test. With only a handful of pairs this is the honest
 * choice: it assumes nothing about the shape of the noise, just asks how likely
 * this many wins would be from coin flips.
 */
function signTestP(improved: number, n: number): number {
  if (n === 0) return 1;
  const k = Math.min(improved, n - improved);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += binomCoef(n, i);
  return Math.min(1, (2 * tail) / 2 ** n);
}

function totalFor(run: RunJson, name: string): number {
  const r = run.results.find((x) => x.name === name);
  if (!r) throw new Error(`Benchmark "${name}" missing from a run`);
  return r.total;
}

function weightedTotal(run: RunJson): number {
  return run.results.reduce((sum, r) => sum + r.total * (KRAUSE_WEIGHTS[r.name] ?? 1), 0);
}

interface Row {
  name: string;
  controlMedian: number;
  experimentMedian: number;
  deltaMedian: number;
  improved: number;
  n: number;
  p: number;
}

function summarize(name: string, get: (run: RunJson) => number): Row {
  const controls = pairs.map((p) => get(p.control));
  const experiments = pairs.map((p) => get(p.experiment));
  const deltas = pairs.map((_, i) => ((experiments[i] - controls[i]) / controls[i]) * 100);
  // Ties contribute no evidence either way, so they leave the sign test entirely.
  const decided = deltas.filter((d) => d !== 0);
  const improved = decided.filter((d) => d < 0).length;
  return {
    name,
    controlMedian: median(controls),
    experimentMedian: median(experiments),
    deltaMedian: median(deltas),
    improved,
    n: decided.length,
    p: signTestP(improved, decided.length),
  };
}

const benchmarkNames: string[] = pairs[0].control.results.map((r) => r.name);
const rows = benchmarkNames.map((name) => summarize(name, (run) => totalFor(run, name)));
const weightedRow = summarize("**Weighted total**", weightedTotal);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const SIGNIFICANT = 0.05;

function fmtDelta(row: Row): string {
  const sign = row.deltaMedian > 0 ? "+" : "";
  const value = `${sign}${row.deltaMedian.toFixed(1)}%`;
  if (row.p > SIGNIFICANT) return value;
  return row.deltaMedian < 0 ? `**${value}** 🟢` : `**${value}** 🔴`;
}

function renderRow(row: Row): string {
  return [
    row.name,
    `${row.controlMedian.toFixed(1)} ms`,
    `${row.experimentMedian.toFixed(1)} ms`,
    fmtDelta(row),
    `${row.improved}/${row.n}`,
    row.p < 0.001 ? "<0.001" : row.p.toFixed(3),
  ].join(" | ");
}

const significant = rows.filter((r) => r.p <= SIGNIFICANT);
const faster = significant.filter((r) => r.deltaMedian < 0);
const slower = significant.filter((r) => r.deltaMedian > 0);

const verdict = (() => {
  if (slower.length > 0) {
    return `⚠️ **${slower.length} benchmark(s) look slower**: ${slower
      .map((r) => `\`${r.name}\``)
      .join(
        ", ",
      )}. Before treating that as real, check whether the change alters allocation volume — see the GC-aliasing note below.`;
  }
  if (faster.length > 0) {
    return `🟢 **${faster.length} benchmark(s) look faster**, none slower.`;
  }
  return "No benchmark moved beyond what coin-flip noise would produce.";
})();

const report = `<!-- supergrain-benchmark -->
### 📊 Interleaved benchmark: ${experimentLabel} vs ${controlLabel}

${verdict}

${runs} interleaved pairs. Negative Δ = **faster on this PR**. Bold + coloured rows are the ones where a two-sided sign test clears p ≤ ${SIGNIFICANT}.

| Benchmark | ${controlLabel} | ${experimentLabel} | Δ median | pairs improved | sign test p |
| --- | ---: | ---: | ---: | ---: | ---: |
${rows.map((r) => `| ${renderRow(r)} |`).join("\n")}
| ${renderRow(weightedRow)} |

<details>
<summary>How to read this</summary>

${
  mode === "kernel"
    ? "Both arms are the **same** app source and the same commit of `js-krauset`; only `packages/kernel/dist` differs — this comparison isolates the kernel change and is blind to app-side changes."
    : "Each arm is a **complete prebuilt app bundle** (kernel + app), so this measures the full difference between the two builds — app-side and kernel-side changes alike."
} The two builds alternate within one time window, with the order flipped each pair, so machine drift hits both arms equally and the paired delta cancels it.

CI runners are shared and noisy, so **absolute milliseconds here are meaningless** — do not compare them against numbers from your laptop or against a previous run of this job. The paired delta and the win count are the signal.

With ${runs} pairs a sign test needs roughly ${runs - 1}/${runs} wins to clear p ≤ ${SIGNIFICANT}, so this job is good at catching large regressions and weak at resolving effects under a few percent. A borderline result means "run it properly", not "no effect".

**GC aliasing.** A change that removes allocations can shift when V8's scavenge lands relative to the measured window and show up as a reproducible regression on churn-heavy benchmarks with *both* script and paint time inflating together. That fingerprint is an artifact, not added work. To check, re-run the suspect benchmark with a forced collection before tracing:

\`\`\`
PROFILE=1 npx vitest run --config vitest.dist.config.ts src/perf.test.ts -t "create rows"
\`\`\`

(\`-t\` is a regex — \`"create rows (1k)"\` matches nothing.) If the regression disappears, it was aliasing. See \`OPTIMIZATION-AGENT.md\`.
</details>
`;

writeFileSync(outPath, report);
writeFileSync(
  jsonPath,
  JSON.stringify(
    {
      runs,
      controlLabel,
      experimentLabel,
      rows: [...rows, weightedRow],
      pairs: pairs.map((p) => ({ control: p.control.results, experiment: p.experiment.results })),
    },
    null,
    2,
  ) + "\n",
);

console.log(`\n${report}`);
console.log(`Report written to ${outPath}`);
console.log(`Raw paired data written to ${jsonPath}`);
