import { readFileSync } from "fs";
import { resolve } from "path";

const sgDir = __dirname;
const rhDir = resolve(__dirname, "../js-krauset-react-hooks");

// Use the latest SG stats (post all 4 ideas)
const sg = JSON.parse(readFileSync(resolve(sgDir, "perf-stats-ideas34.json"), "utf-8"));
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

function welchT(mean1: number, std1: number, n1: number, mean2: number, std2: number, n2: number) {
  const se1 = (std1 * std1) / n1;
  const se2 = (std2 * std2) / n2;
  const se = Math.sqrt(se1 + se2);
  if (se === 0) return { t: 0, df: n1 + n2 - 2, p_approx: "n/a", significant: false };
  const t = (mean1 - mean2) / se;
  const num = (se1 + se2) ** 2;
  const den = (se1 * se1) / (n1 - 1) + (se2 * se2) / (n2 - 1);
  const df = num / den;
  const absT = Math.abs(t);
  const thresh = df >= 20 ? [3.5, 2.85, 2.09] : [3.85, 3.0, 2.15];
  let p_approx: string;
  let significant: boolean;
  if (absT > thresh[0]) {
    p_approx = "< 0.001";
    significant = true;
  } else if (absT > thresh[1]) {
    p_approx = "< 0.01";
    significant = true;
  } else if (absT > thresh[2]) {
    p_approx = "< 0.05";
    significant = true;
  } else {
    p_approx = "> 0.05";
    significant = false;
  }
  return { t, df, p_approx, significant };
}

const nSg = sg.runCount;
const nRh = rh.runCount;

console.log(`SG: ${nSg} runs (ideas34, post all 4 optimizations)`);
console.log(`RH: ${nRh} runs (react-hooks baseline)\n`);

// ─── Total time ───
console.log("━━━ TOTAL TIME: Current SG vs RH ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "SG".padStart(8) +
    "RH".padStart(8) +
    "Δ".padStart(8) +
    "Δ%".padStart(8) +
    "t".padStart(7) +
    "p".padStart(10) +
    "sig?".padStart(6) +
    "W".padStart(6),
);
console.log("─".repeat(75));

for (const name of Object.keys(weights)) {
  const s = sg.benchmarks[name]?.total;
  const r = rh.benchmarks[name]?.total;
  if (!s || !r) continue;
  const delta = s.mean - r.mean;
  const pct = (delta / r.mean) * 100;
  const test = welchT(s.mean, s.stddev, nSg, r.mean, r.stddev, nRh);
  console.log(
    (shortNames[name] || name).padEnd(14) +
      s.median.toFixed(1).padStart(8) +
      r.median.toFixed(1).padStart(8) +
      ((delta > 0 ? "+" : "") + delta.toFixed(1)).padStart(8) +
      ((delta > 0 ? "+" : "") + pct.toFixed(0) + "%").padStart(8) +
      test.t.toFixed(2).padStart(7) +
      test.p_approx.padStart(10) +
      (test.significant ? "  YES" : "   no").padStart(6) +
      weights[name].toFixed(2).padStart(6),
  );
}

// ─── Script time ───
console.log("\n\n━━━ SCRIPT TIME: Current SG vs RH ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "SG".padStart(8) +
    "RH".padStart(8) +
    "Δ".padStart(8) +
    "Δ%".padStart(8) +
    "t".padStart(7) +
    "p".padStart(10) +
    "sig?".padStart(6),
);
console.log("─".repeat(69));

for (const name of Object.keys(weights)) {
  const s = sg.benchmarks[name]?.script;
  const r = rh.benchmarks[name]?.script;
  if (!s || !r) continue;
  const delta = s.mean - r.mean;
  const pct = (delta / r.mean) * 100;
  const test = welchT(s.mean, s.stddev, nSg, r.mean, r.stddev, nRh);
  console.log(
    (shortNames[name] || name).padEnd(14) +
      s.median.toFixed(1).padStart(8) +
      r.median.toFixed(1).padStart(8) +
      ((delta > 0 ? "+" : "") + delta.toFixed(1)).padStart(8) +
      ((delta > 0 ? "+" : "") + pct.toFixed(0) + "%").padStart(8) +
      test.t.toFixed(2).padStart(7) +
      test.p_approx.padStart(10) +
      (test.significant ? "  YES" : "   no").padStart(6),
  );
}

// ─── Functions unique to SG in new profiles (create-10k is the biggest gap) ───
console.log("\n\n━━━ NEW PROFILE: SG-only functions in create-10k ━━━\n");

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string };
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
  return funcTime;
}

const sg10k = getFuncTimes(sgDir, "create-10k");
const rh10k = getFuncTimes(rhDir, "create-10k");

const diffs: { fn: string; sgMs: number; rhMs: number; diff: number }[] = [];
for (const fn of sg10k.keys()) {
  if (fn === "(idle)" || fn === "(program)") continue;
  const sgMs = (sg10k.get(fn) || 0) / 1000;
  const rhMs = (rh10k.get(fn) || 0) / 1000;
  if (sgMs > 1 && sgMs > rhMs + 0.5) {
    diffs.push({
      fn,
      sgMs: +sgMs.toFixed(1),
      rhMs: +rhMs.toFixed(1),
      diff: +(sgMs - rhMs).toFixed(1),
    });
  }
}
diffs.sort((a, b) => b.diff - a.diff);

console.log("  " + "Function".padEnd(45) + "SG".padStart(8) + "RH".padStart(8) + "Δ".padStart(8));
console.log("  " + "─".repeat(69));
for (const d of diffs.slice(0, 20)) {
  console.log(
    "  " +
      d.fn.padEnd(45) +
      (d.sgMs + "ms").padStart(8) +
      (d.rhMs + "ms").padStart(8) +
      ("+" + d.diff + "ms").padStart(8),
  );
}

// ─── Ceiling ───
console.log("\n\n━━━ UPDATED CEILING ━━━\n");

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

function geoMean(ratios: number[]): number {
  return Math.exp(ratios.reduce((s, r) => s + Math.log(r), 0) / ratios.length);
}

const sgRatios: number[] = [];
const ceilingRatios: number[] = [];

for (const name of Object.keys(weights)) {
  const fast = solidStore[name];
  const sgT = sg.benchmarks[name].total.median;
  const rhT = rh.benchmarks[name].total.median;
  sgRatios.push(sgT / fast);
  ceilingRatios.push(Math.min(sgT, rhT) / fast);
}

console.log("Current SG geo mean:  " + geoMean(sgRatios).toFixed(3));
console.log("Ceiling geo mean:     " + geoMean(ceilingRatios).toFixed(3));
console.log("(Ceiling = take the better of SG/RH for each benchmark)");
