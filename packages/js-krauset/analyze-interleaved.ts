import { readFileSync } from "fs";
import { resolve } from "path";

const sgDir = __dirname;
const rhDir = resolve(__dirname, "../js-krauset-react-hooks");

// Parallel runs (ran simultaneously)
const sgP = JSON.parse(readFileSync(resolve(sgDir, "perf-stats-supergrain.json"), "utf-8"));
const rhP = JSON.parse(readFileSync(resolve(rhDir, "perf-stats-react-hooks.json"), "utf-8"));

// Interleaved runs (alternating SG→RH→SG→RH)
const sgI = JSON.parse(readFileSync(resolve(sgDir, "perf-stats-sg-interleaved.json"), "utf-8"));
const rhI = JSON.parse(readFileSync(resolve(rhDir, "perf-stats-rh-interleaved.json"), "utf-8"));

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
  if (se === 0) return { t: 0, df: n1 + n2 - 2, p_approx: "n/a" };
  const t = (mean1 - mean2) / se;
  const num = (se1 + se2) ** 2;
  const den = (se1 * se1) / (n1 - 1) + (se2 * se2) / (n2 - 1);
  const df = num / den;
  const absT = Math.abs(t);
  const thresh = df >= 20 ? [3.5, 2.85, 2.09, 1.72] : [3.85, 3.0, 2.15, 1.76];
  let p_approx: string;
  if (absT > thresh[0]) p_approx = "< 0.001";
  else if (absT > thresh[1]) p_approx = "< 0.01";
  else if (absT > thresh[2]) p_approx = "< 0.05";
  else if (absT > thresh[3]) p_approx = "< 0.10";
  else p_approx = "> 0.10";
  return { t, df, p_approx };
}

// ─── Compare parallel vs interleaved: do the deltas agree? ───
console.log("━━━ TOTAL TIME: Parallel (n=15) vs Interleaved (n=10) ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "Par SG".padStart(8) +
    "Par RH".padStart(8) +
    "Par Δ".padStart(8) +
    "Int SG".padStart(8) +
    "Int RH".padStart(8) +
    "Int Δ".padStart(8) +
    "Agree?".padStart(8),
);
console.log("─".repeat(70));

for (const name of Object.keys(weights)) {
  const sp = sgP.benchmarks[name]?.total;
  const rp = rhP.benchmarks[name]?.total;
  const si = sgI.benchmarks[name]?.total;
  const ri = rhI.benchmarks[name]?.total;
  if (!sp || !rp || !si || !ri) continue;

  const parDelta = sp.mean - rp.mean;
  const intDelta = si.mean - ri.mean;
  const sameSign =
    (parDelta > 0 && intDelta > 0) ||
    (parDelta < 0 && intDelta < 0) ||
    (Math.abs(parDelta) < 1 && Math.abs(intDelta) < 1);

  console.log(
    (shortNames[name] || name).padEnd(14) +
      sp.median.toFixed(1).padStart(8) +
      rp.median.toFixed(1).padStart(8) +
      ((parDelta > 0 ? "+" : "") + parDelta.toFixed(1)).padStart(8) +
      si.median.toFixed(1).padStart(8) +
      ri.median.toFixed(1).padStart(8) +
      ((intDelta > 0 ? "+" : "") + intDelta.toFixed(1)).padStart(8) +
      (sameSign ? "YES" : "NO").padStart(8),
  );
}

// ─── Script time comparison ───
console.log("\n\n━━━ SCRIPT TIME: Parallel (n=15) vs Interleaved (n=10) ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "Par Δ".padStart(8) +
    "Par p".padStart(10) +
    "Int Δ".padStart(8) +
    "Int p".padStart(10) +
    "Agree?".padStart(8),
);
console.log("─".repeat(58));

for (const name of Object.keys(weights)) {
  const sp = sgP.benchmarks[name]?.script;
  const rp = rhP.benchmarks[name]?.script;
  const si = sgI.benchmarks[name]?.script;
  const ri = rhI.benchmarks[name]?.script;
  if (!sp || !rp || !si || !ri) continue;

  const parDelta = sp.mean - rp.mean;
  const intDelta = si.mean - ri.mean;
  const parT = welchT(sp.mean, sp.stddev, 15, rp.mean, rp.stddev, 15);
  const intT = welchT(si.mean, si.stddev, 10, ri.mean, ri.stddev, 10);
  const sameSign = (parDelta > 0 && intDelta > 0) || (parDelta < 0 && intDelta < 0);

  console.log(
    (shortNames[name] || name).padEnd(14) +
      ((parDelta > 0 ? "+" : "") + parDelta.toFixed(1)).padStart(8) +
      parT.p_approx.padStart(10) +
      ((intDelta > 0 ? "+" : "") + intDelta.toFixed(1)).padStart(8) +
      intT.p_approx.padStart(10) +
      (sameSign ? "YES" : "NO").padStart(8),
  );
}

// ─── Full interleaved significance table ───
console.log("\n\n━━━ INTERLEAVED TOTAL TIME: Welch's t-test (n=10 each) ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "SG mean".padStart(8) +
    "RH mean".padStart(8) +
    "SG σ".padStart(7) +
    "RH σ".padStart(7) +
    "Δ".padStart(8) +
    "t".padStart(7) +
    "p".padStart(10),
);
console.log("─".repeat(69));

for (const name of Object.keys(weights)) {
  const s = sgI.benchmarks[name]?.total;
  const r = rhI.benchmarks[name]?.total;
  if (!s || !r) continue;

  const delta = s.mean - r.mean;
  const test = welchT(s.mean, s.stddev, 10, r.mean, r.stddev, 10);

  console.log(
    (shortNames[name] || name).padEnd(14) +
      s.mean.toFixed(1).padStart(8) +
      r.mean.toFixed(1).padStart(8) +
      s.stddev.toFixed(1).padStart(7) +
      r.stddev.toFixed(1).padStart(7) +
      ((delta > 0 ? "+" : "") + delta.toFixed(1)).padStart(8) +
      test.t.toFixed(2).padStart(7) +
      test.p_approx.padStart(10),
  );
}

// ─── Interleaved script significance ───
console.log("\n\n━━━ INTERLEAVED SCRIPT TIME: Welch's t-test (n=10 each) ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "SG mean".padStart(8) +
    "RH mean".padStart(8) +
    "SG σ".padStart(7) +
    "RH σ".padStart(7) +
    "Δ".padStart(8) +
    "t".padStart(7) +
    "p".padStart(10),
);
console.log("─".repeat(69));

for (const name of Object.keys(weights)) {
  const s = sgI.benchmarks[name]?.script;
  const r = rhI.benchmarks[name]?.script;
  if (!s || !r) continue;

  const delta = s.mean - r.mean;
  const test = welchT(s.mean, s.stddev, 10, r.mean, r.stddev, 10);

  console.log(
    (shortNames[name] || name).padEnd(14) +
      s.mean.toFixed(1).padStart(8) +
      r.mean.toFixed(1).padStart(8) +
      s.stddev.toFixed(1).padStart(7) +
      r.stddev.toFixed(1).padStart(7) +
      ((delta > 0 ? "+" : "") + delta.toFixed(1)).padStart(8) +
      test.t.toFixed(2).padStart(7) +
      test.p_approx.padStart(10),
  );
}
