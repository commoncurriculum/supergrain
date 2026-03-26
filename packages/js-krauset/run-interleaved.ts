import { execSync } from "child_process";
import { resolve } from "path";

const sgDir = resolve(__dirname);
const rhDir = resolve(__dirname, "../js-krauset-react-hooks");
const runs = 10;

// Build both first
console.log("Building supergrain...");
execSync("pnpm build-prod", { cwd: sgDir, stdio: "ignore" });
console.log("Building react-hooks...");
execSync("pnpm build-prod", { cwd: rhDir, stdio: "ignore" });

// Interleaved runs: SG then RH, alternating
for (let i = 1; i <= runs; i++) {
  console.log(`=== Run ${i}/${runs} ===`);
  console.log("  supergrain...");
  execSync("pnpm test:perf", { cwd: sgDir, stdio: "ignore", timeout: 120_000 });
  console.log("  react-hooks...");
  execSync("pnpm test:perf", { cwd: rhDir, stdio: "ignore", timeout: 120_000 });
}

// Compute stats
console.log("\nComputing stats...");
execSync(`node perf-stats.ts sg-interleaved ${runs}`, { cwd: sgDir, stdio: "inherit" });
execSync(`node perf-stats.ts rh-interleaved ${runs}`, { cwd: rhDir, stdio: "inherit" });
console.log("Done.");
