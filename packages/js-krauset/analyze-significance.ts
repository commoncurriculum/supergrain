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

// Welch's t-test for unequal variances
function welchT(
  mean1: number,
  std1: number,
  n1: number,
  mean2: number,
  std2: number,
  n2: number,
): { t: number; df: number; significant: boolean; p_approx: string } {
  const se1 = (std1 * std1) / n1;
  const se2 = (std2 * std2) / n2;
  const se = Math.sqrt(se1 + se2);
  if (se === 0) return { t: 0, df: n1 + n2 - 2, significant: false, p_approx: "n/a" };

  const t = (mean1 - mean2) / se;

  // Welch-Satterthwaite degrees of freedom
  const num = (se1 + se2) ** 2;
  const den = (se1 * se1) / (n1 - 1) + (se2 * se2) / (n2 - 1);
  const df = num / den;

  // Approximate p-value using t-distribution
  // For df > 30, t > 2.04 is p < 0.05, t > 2.75 is p < 0.01, t > 3.50 is p < 0.001
  // For df ~15-28 (our case), thresholds are slightly higher
  const absT = Math.abs(t);
  let p_approx: string;
  let significant: boolean;
  if (df >= 20) {
    if (absT > 3.5) {
      p_approx = "< 0.001";
      significant = true;
    } else if (absT > 2.85) {
      p_approx = "< 0.01";
      significant = true;
    } else if (absT > 2.09) {
      p_approx = "< 0.05";
      significant = true;
    } else if (absT > 1.72) {
      p_approx = "< 0.10";
      significant = false;
    } else {
      p_approx = "> 0.10";
      significant = false;
    }
  } else {
    // More conservative for lower df
    if (absT > 3.85) {
      p_approx = "< 0.001";
      significant = true;
    } else if (absT > 3.0) {
      p_approx = "< 0.01";
      significant = true;
    } else if (absT > 2.15) {
      p_approx = "< 0.05";
      significant = true;
    } else if (absT > 1.76) {
      p_approx = "< 0.10";
      significant = false;
    } else {
      p_approx = "> 0.10";
      significant = false;
    }
  }

  return { t, df, significant, p_approx };
}

const n = 15;

// ─── Total time with statistical significance ───
console.log("━━━ TOTAL TIME: Welch's t-test (n=15 each, two-tailed) ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "SG med".padStart(8) +
    "RH med".padStart(8) +
    "SG mean".padStart(8) +
    "RH mean".padStart(8) +
    "SG σ".padStart(7) +
    "RH σ".padStart(7) +
    "Δ mean".padStart(8) +
    "t".padStart(7) +
    "p".padStart(10) +
    "sig?".padStart(6),
);
console.log("─".repeat(99));

for (const name of Object.keys(weights)) {
  const s = sg.benchmarks[name]?.total;
  const r = rh.benchmarks[name]?.total;
  if (!s || !r) continue;

  const delta = s.mean - r.mean;
  const test = welchT(s.mean, s.stddev, n, r.mean, r.stddev, n);
  const short = shortNames[name] || name;

  console.log(
    short.padEnd(14) +
      s.median.toFixed(1).padStart(8) +
      r.median.toFixed(1).padStart(8) +
      s.mean.toFixed(1).padStart(8) +
      r.mean.toFixed(1).padStart(8) +
      s.stddev.toFixed(1).padStart(7) +
      r.stddev.toFixed(1).padStart(7) +
      ((delta > 0 ? "+" : "") + delta.toFixed(1)).padStart(8) +
      test.t.toFixed(2).padStart(7) +
      test.p_approx.padStart(10) +
      (test.significant ? "  YES" : "   no").padStart(6),
  );
}

// ─── Script time with statistical significance ───
console.log("\n\n━━━ SCRIPT TIME: Welch's t-test (n=15 each, two-tailed) ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "SG med".padStart(8) +
    "RH med".padStart(8) +
    "SG mean".padStart(8) +
    "RH mean".padStart(8) +
    "SG σ".padStart(7) +
    "RH σ".padStart(7) +
    "Δ mean".padStart(8) +
    "t".padStart(7) +
    "p".padStart(10) +
    "sig?".padStart(6),
);
console.log("─".repeat(99));

for (const name of Object.keys(weights)) {
  const s = sg.benchmarks[name]?.script;
  const r = rh.benchmarks[name]?.script;
  if (!s || !r) continue;

  const delta = s.mean - r.mean;
  const test = welchT(s.mean, s.stddev, n, r.mean, r.stddev, n);
  const short = shortNames[name] || name;

  console.log(
    short.padEnd(14) +
      s.median.toFixed(1).padStart(8) +
      r.median.toFixed(1).padStart(8) +
      s.mean.toFixed(1).padStart(8) +
      r.mean.toFixed(1).padStart(8) +
      s.stddev.toFixed(1).padStart(7) +
      r.stddev.toFixed(1).padStart(7) +
      ((delta > 0 ? "+" : "") + delta.toFixed(1)).padStart(8) +
      test.t.toFixed(2).padStart(7) +
      test.p_approx.padStart(10) +
      (test.significant ? "  YES" : "   no").padStart(6),
  );
}

// ─── Paint time with statistical significance ───
console.log("\n\n━━━ PAINT TIME: Welch's t-test (n=15 each, two-tailed) ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "SG med".padStart(8) +
    "RH med".padStart(8) +
    "SG mean".padStart(8) +
    "RH mean".padStart(8) +
    "SG σ".padStart(7) +
    "RH σ".padStart(7) +
    "Δ mean".padStart(8) +
    "t".padStart(7) +
    "p".padStart(10) +
    "sig?".padStart(6),
);
console.log("─".repeat(99));

for (const name of Object.keys(weights)) {
  const s = sg.benchmarks[name]?.paint;
  const r = rh.benchmarks[name]?.paint;
  if (!s || !r) continue;

  const delta = s.mean - r.mean;
  const test = welchT(s.mean, s.stddev, n, r.mean, r.stddev, n);
  const short = shortNames[name] || name;

  console.log(
    short.padEnd(14) +
      s.median.toFixed(1).padStart(8) +
      r.median.toFixed(1).padStart(8) +
      s.mean.toFixed(1).padStart(8) +
      r.mean.toFixed(1).padStart(8) +
      s.stddev.toFixed(1).padStart(7) +
      r.stddev.toFixed(1).padStart(7) +
      ((delta > 0 ? "+" : "") + delta.toFixed(1)).padStart(8) +
      test.t.toFixed(2).padStart(7) +
      test.p_approx.padStart(10) +
      (test.significant ? "  YES" : "   no").padStart(6),
  );
}

// ─── Min/Max ranges ───
console.log("\n\n━━━ TOTAL TIME: Min/Max ranges (overlap = less confident) ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "SG min".padStart(8) +
    "SG max".padStart(8) +
    "RH min".padStart(8) +
    "RH max".padStart(8) +
    "overlap?".padStart(10),
);
console.log("─".repeat(56));

for (const name of Object.keys(weights)) {
  const s = sg.benchmarks[name]?.total;
  const r = rh.benchmarks[name]?.total;
  if (!s || !r) continue;

  const overlap = s.min <= r.max && r.min <= s.max;
  const short = shortNames[name] || name;

  console.log(
    short.padEnd(14) +
      s.min.toFixed(1).padStart(8) +
      s.max.toFixed(1).padStart(8) +
      r.min.toFixed(1).padStart(8) +
      r.max.toFixed(1).padStart(8) +
      (overlap ? "YES" : "NO").padStart(10),
  );
}

// ─── Weighted script gap with confidence ───
console.log("\n\n━━━ WEIGHTED SCRIPT GAP (only statistically significant deltas) ━━━\n");
let totalWeighted = 0;
let totalWeightedSig = 0;

for (const name of Object.keys(weights)) {
  const s = sg.benchmarks[name]?.script;
  const r = rh.benchmarks[name]?.script;
  if (!s || !r) continue;

  const delta = s.mean - r.mean;
  const w = weights[name];
  const wDelta = delta * w;
  const test = welchT(s.mean, s.stddev, n, r.mean, r.stddev, n);
  const short = shortNames[name] || name;

  totalWeighted += wDelta;
  if (test.significant) {
    totalWeightedSig += wDelta;
    console.log(
      "  " +
        short.padEnd(14) +
        ("Δ=" + (delta > 0 ? "+" : "") + delta.toFixed(1) + "ms").padStart(14) +
        ("w=" + w.toFixed(2)).padStart(10) +
        ("wΔ=" + (wDelta > 0 ? "+" : "") + wDelta.toFixed(1) + "ms").padStart(14) +
        ("  p " + test.p_approx),
    );
  } else {
    console.log(
      "  " +
        short.padEnd(14) +
        ("Δ=" + (delta > 0 ? "+" : "") + delta.toFixed(1) + "ms").padStart(14) +
        "  NOT SIGNIFICANT (p " +
        test.p_approx +
        ")",
    );
  }
}
console.log("─".repeat(70));
console.log(
  "  Total weighted script gap (all):            " +
    ((totalWeighted > 0 ? "+" : "") + totalWeighted.toFixed(1) + "ms"),
);
console.log(
  "  Total weighted script gap (significant only): " +
    ((totalWeightedSig > 0 ? "+" : "") + totalWeightedSig.toFixed(1) + "ms"),
);
