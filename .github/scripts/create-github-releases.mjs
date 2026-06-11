// Create a GitHub Release (and its git tag) for each published @supergrain
// package version that doesn't have one yet.
//
// Why this exists: the release workflow publishes with `pnpm -r publish` so the
// `workspace:*` protocol is rewritten correctly (see pnpm "Using Changesets").
// That command doesn't print the `New tag:` lines changesets/action looks for,
// so the action can't create GitHub Releases. This script fills that gap.
//
// It is safe to run repeatedly: it only creates a Release when the package's
// current version is actually live on npm AND no Release exists for that tag,
// so it both publishes new releases and backfills any that were missed.
//
// Env: GITHUB_TOKEN (contents: write), GITHUB_REPOSITORY, GITHUB_SHA — all set
// automatically by GitHub Actions.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const token = process.env.GITHUB_TOKEN;
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
const sha = process.env.GITHUB_SHA;

if (!token || !owner || !repo) {
  console.error("Missing GITHUB_TOKEN / GITHUB_REPOSITORY env.");
  process.exit(1);
}

const PACKAGES_DIR = "packages";

async function gh(method, route, body) {
  return fetch(`https://api.github.com${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Pull the notes for `version` out of a package's CHANGELOG.md. Changesets
// writes one `## <version>` heading per release, so slice between headings.
function changelogNotes(pkgDir, version) {
  const file = path.join(pkgDir, "CHANGELOG.md");
  if (!existsSync(file)) return "";
  const lines = readFileSync(file, "utf8").split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

// The registry can be briefly eventually-consistent right after `npm publish`
// (a version that was just published may 404 for a few seconds). Retry with
// backoff so a fresh publish isn't mistaken for "not published".
async function isOnNpm(name, version, { attempts = 6, baseDelayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`https://registry.npmjs.org/${name}/${version}`, {
        headers: { accept: "application/json" },
      });
      if (res.ok) return true;
    } catch {
      // network blip — fall through to retry
    }
    if (attempt < attempts) {
      await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
    }
  }
  return false;
}

// Tags are effectively immutable once pushed, so point each Release at the
// commit that actually introduced `version` (the changesets "Version Packages"
// commit) rather than whatever commit happens to be running this workflow.
// Otherwise backfilled Releases would be tagged at an unrelated later commit.
// Requires full git history (checkout with fetch-depth: 0); falls back to the
// current SHA if the commit can't be determined.
function commitForVersion(pkgDir, version) {
  const pattern = `"version": "${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`;
  const result = spawnSync(
    "git",
    ["log", "-1", "--format=%H", "-G", pattern, "--", `${pkgDir}/package.json`],
    { encoding: "utf8" },
  );
  const found = (result.stdout ?? "").trim();
  return found || sha;
}

let created = 0;
let failed = 0;

for (const entry of readdirSync(PACKAGES_DIR)) {
  const dir = path.join(PACKAGES_DIR, entry);
  const manifestPath = path.join(dir, "package.json");
  if (!existsSync(manifestPath)) continue;

  const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (pkg.private || !pkg.name?.startsWith("@supergrain/")) continue;

  const tag = `${pkg.name}@${pkg.version}`;

  if (!(await isOnNpm(pkg.name, pkg.version))) {
    console.log(`· ${tag} — not on npm yet, skipping`);
    continue;
  }

  const existing = await gh(
    "GET",
    `/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
  );
  if (existing.ok) {
    console.log(`· ${tag} — release already exists, skipping`);
    continue;
  }

  const res = await gh("POST", `/repos/${owner}/${repo}/releases`, {
    tag_name: tag,
    target_commitish: commitForVersion(dir, pkg.version),
    name: tag,
    body: changelogNotes(dir, pkg.version) || `Release ${tag}`,
  });

  if (res.ok) {
    console.log(`✓ created release ${tag}`);
    created++;
  } else {
    console.error(`✗ failed to create ${tag}: ${res.status} ${await res.text()}`);
    failed++;
  }
}

console.log(`Done. Created ${created} release(s), ${failed} failure(s).`);
if (failed > 0) process.exit(1);
