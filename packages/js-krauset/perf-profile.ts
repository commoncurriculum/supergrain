import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";

const dir = import.meta.dirname;
const targetFile = process.argv[2];

interface ProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
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

function analyzeProfile(profile: Profile) {
  const nodeMap = new Map<number, ProfileNode>();
  for (const node of profile.nodes) {
    nodeMap.set(node.id, node);
  }

  // Compute self time from samples + timeDeltas
  const selfTime = new Map<number, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    const nodeId = profile.samples[i];
    const delta = profile.timeDeltas[i];
    selfTime.set(nodeId, (selfTime.get(nodeId) || 0) + delta);
  }

  // Aggregate by function name + url
  const funcStats = new Map<string, { selfTime: number; hitCount: number; url: string }>();
  for (const [nodeId, time] of selfTime) {
    const node = nodeMap.get(nodeId)!;
    const cf = node.callFrame;
    const key = `${cf.functionName || "(anonymous)"}|${cf.url}:${cf.lineNumber}`;
    const existing = funcStats.get(key) || { selfTime: 0, hitCount: 0, url: cf.url };
    existing.selfTime += time;
    existing.hitCount += node.hitCount;
    funcStats.set(key, existing);
  }

  // Sort by self time descending
  const sorted = [...funcStats.entries()]
    .sort((a, b) => b[1].selfTime - a[1].selfTime)
    .slice(0, 30);

  const totalTime = profile.endTime - profile.startTime;

  return { sorted, totalTime };
}

function formatUrl(url: string): string {
  if (!url) return "(native)";
  // Strip to just filename
  const parts = url.split("/");
  return parts[parts.length - 1];
}

function printProfile(name: string, profile: Profile) {
  const { sorted, totalTime } = analyzeProfile(profile);
  const totalMs = totalTime / 1000;

  console.log(`\n${"═".repeat(80)}`);
  console.log(`${name} — total: ${totalMs.toFixed(1)}ms`);
  console.log(`${"═".repeat(80)}`);
  console.log(
    "Self ms".padStart(10) + "Self %".padStart(8) + "  " + "Function".padEnd(40) + "File",
  );
  console.log("─".repeat(80));

  for (const [key, stats] of sorted) {
    const [funcPart, filePart] = key.split("|");
    const selfMs = stats.selfTime / 1000;
    const selfPct = (stats.selfTime / totalTime) * 100;
    if (selfMs < 0.1) continue;
    console.log(
      `${selfMs.toFixed(1)}ms`.padStart(10) +
        `${selfPct.toFixed(1)}%`.padStart(8) +
        "  " +
        funcPart.padEnd(40).slice(0, 40) +
        formatUrl(filePart.split(":")[0]),
    );
  }
}

// If a specific file is given, just analyze that one
if (targetFile) {
  const filePath = resolve(
    dir,
    targetFile.endsWith(".cpuprofile") ? targetFile : `${targetFile}.cpuprofile`,
  );
  const profile = JSON.parse(readFileSync(filePath, "utf-8"));
  printProfile(targetFile.replace(".cpuprofile", ""), profile);
} else {
  // Analyze all .cpuprofile files
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".cpuprofile"))
    .sort();

  if (files.length === 0) {
    console.error("No .cpuprofile files found. Run pnpm test:perf first.");
    process.exit(1);
  }

  for (const file of files) {
    const profile = JSON.parse(readFileSync(resolve(dir, file), "utf-8"));
    printProfile(file.replace(".cpuprofile", ""), profile);
  }
}
