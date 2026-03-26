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

console.log(`Supergrain: ${sg.runCount} runs, commit ${sg.git?.commit || "?"}`);
console.log(`React-hooks: ${rh.runCount} runs, commit ${rh.git?.commit || "?"}`);

// ─── Total time comparison ───
console.log("\n━━━ TOTAL TIME (median ms) ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "SG".padStart(8) +
    "RH".padStart(8) +
    "Δ".padStart(8) +
    "Δ%".padStart(8) +
    "W".padStart(6) +
    "WΔ".padStart(8),
);
console.log("─".repeat(60));

let totalWeightedDelta = 0;

for (const name of Object.keys(weights)) {
  const sgTotal = sg.benchmarks[name]?.total?.median;
  const rhTotal = rh.benchmarks[name]?.total?.median;
  if (sgTotal == null || rhTotal == null) continue;

  const delta = sgTotal - rhTotal;
  const pct = (delta / rhTotal) * 100;
  const w = weights[name];
  const wDelta = delta * w;
  totalWeightedDelta += wDelta;

  console.log(
    (shortNames[name] || name).padEnd(14) +
      sgTotal.toFixed(1).padStart(8) +
      rhTotal.toFixed(1).padStart(8) +
      ((delta > 0 ? "+" : "") + delta.toFixed(1)).padStart(8) +
      ((delta > 0 ? "+" : "") + pct.toFixed(0) + "%").padStart(8) +
      w.toFixed(2).padStart(6) +
      ((wDelta > 0 ? "+" : "") + wDelta.toFixed(1)).padStart(8),
  );
}
console.log("─".repeat(60));
console.log(
  "WEIGHTED TOTAL Δ:".padEnd(52) +
    ((totalWeightedDelta > 0 ? "+" : "") + totalWeightedDelta.toFixed(1)).padStart(8),
);

// ─── Script time comparison ───
console.log("\n\n━━━ SCRIPT TIME (median ms) ━━━\n");
console.log(
  "Benchmark".padEnd(14) + "SG".padStart(8) + "RH".padStart(8) + "Δ".padStart(8) + "Δ%".padStart(8),
);
console.log("─".repeat(46));

for (const name of Object.keys(weights)) {
  const sgScript = sg.benchmarks[name]?.script?.median;
  const rhScript = rh.benchmarks[name]?.script?.median;
  if (sgScript == null || rhScript == null) continue;

  const delta = sgScript - rhScript;
  const pct = (delta / rhScript) * 100;

  console.log(
    (shortNames[name] || name).padEnd(14) +
      sgScript.toFixed(1).padStart(8) +
      rhScript.toFixed(1).padStart(8) +
      ((delta > 0 ? "+" : "") + delta.toFixed(1)).padStart(8) +
      ((delta > 0 ? "+" : "") + pct.toFixed(0) + "%").padStart(8),
  );
}

// ─── Paint time comparison ───
console.log("\n\n━━━ PAINT TIME (median ms) ━━━\n");
console.log(
  "Benchmark".padEnd(14) + "SG".padStart(8) + "RH".padStart(8) + "Δ".padStart(8) + "Δ%".padStart(8),
);
console.log("─".repeat(46));

for (const name of Object.keys(weights)) {
  const sgPaint = sg.benchmarks[name]?.paint?.median;
  const rhPaint = rh.benchmarks[name]?.paint?.median;
  if (sgPaint == null || rhPaint == null) continue;

  const delta = sgPaint - rhPaint;
  const pct = rhPaint > 0 ? (delta / rhPaint) * 100 : 0;

  console.log(
    (shortNames[name] || name).padEnd(14) +
      sgPaint.toFixed(1).padStart(8) +
      rhPaint.toFixed(1).padStart(8) +
      ((delta > 0 ? "+" : "") + delta.toFixed(1)).padStart(8) +
      ((delta > 0 ? "+" : "") + pct.toFixed(0) + "%").padStart(8),
  );
}

// ─── Stddev comparison (are results reliable?) ───
console.log("\n\n━━━ STDDEV (total time) — reliability check ━━━\n");
console.log(
  "Benchmark".padEnd(14) +
    "SG σ".padStart(8) +
    "RH σ".padStart(8) +
    "SG σ%".padStart(8) +
    "RH σ%".padStart(8),
);
console.log("─".repeat(46));

for (const name of Object.keys(weights)) {
  const sgStd = sg.benchmarks[name]?.total?.stddev;
  const sgMed = sg.benchmarks[name]?.total?.median;
  const rhStd = rh.benchmarks[name]?.total?.stddev;
  const rhMed = rh.benchmarks[name]?.total?.median;
  if (sgStd == null || rhStd == null) continue;

  console.log(
    (shortNames[name] || name).padEnd(14) +
      sgStd.toFixed(1).padStart(8) +
      rhStd.toFixed(1).padStart(8) +
      (((sgStd / sgMed) * 100).toFixed(1) + "%").padStart(8) +
      (((rhStd / rhMed) * 100).toFixed(1) + "%").padStart(8),
  );
}
