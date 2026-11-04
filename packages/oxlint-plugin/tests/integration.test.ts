import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * `RuleTester` calls each rule's `create()` directly. That proves the rule
 * logic, but not that the plugin *loads* — that it exports the shape oxlint
 * expects, that `jsPlugins` resolves it, and that the rule ids in a config
 * actually match. Those break independently of the rules, and silently: a
 * plugin that fails to register simply reports nothing.
 *
 * So this runs the real oxlint binary over a fixture with known defects and
 * asserts each one is reported — once from inside the workspace, and once from
 * a directory outside it, where only what a consumer installs can resolve.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureConfig = join(packageRoot, "tests/fixtures/.oxlintrc.json");
const fixtureFile = join(packageRoot, "tests/fixtures/sample.tsx");
const distFile = join(packageRoot, "dist/index.js");

function newestMtime(dir: string): number {
  return Math.max(
    ...readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => statSync(join(entry.parentPath, entry.name)).mtimeMs),
  );
}

/**
 * oxlint loads the built plugin, not the TS source: Node's ESM resolver can't
 * map the `.js` specifiers in our TS files onto `.ts` files. Build on demand —
 * when dist is missing or older than src — so this works from a bare checkout
 * and from the root test run, and never checks a stale bundle.
 */
function ensureBuilt(): void {
  const stale = (() => {
    try {
      return statSync(distFile).mtimeMs < newestMtime(join(packageRoot, "src"));
    } catch {
      return true;
    }
  })();
  if (!stale) return;
  execFileSync(join(packageRoot, "node_modules/.bin/vite"), ["build"], {
    cwd: packageRoot,
    stdio: "ignore",
  });
}

function runOxlint(config = fixtureConfig, file = fixtureFile, cwd = packageRoot): string {
  try {
    return execFileSync(join(packageRoot, "node_modules/.bin/oxlint"), ["-c", config, file], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // oxlint exits non-zero when it reports errors, which is the expected path.
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
}

describe("plugin loads in a real oxlint run", () => {
  let output: string;

  beforeAll(() => {
    ensureBuilt();
    output = runOxlint();
  }, 120_000);

  it("registers the plugin under the `supergrain` namespace", () => {
    expect(output).toContain("supergrain(");
  });

  it("reports the untracked component", () => {
    expect(output).toMatch(/supergrain\(require-tracked\).*Untracked/);
  });

  it("reports the async batch callback", () => {
    expect(output).toContain("supergrain(no-async-batch)");
  });

  it("leaves correctly written code alone", () => {
    // `Good` mirrors its prop into reactive state and is wrapped in tracked(),
    // so no supergrain diagnostic should name it.
    const supergrainLines = output.split("\n").filter((line) => line.includes("supergrain("));
    expect(supergrainLines.some((line) => line.includes("Good"))).toBe(false);
    expect(supergrainLines).toHaveLength(2);
  });
});

describe("the built plugin stands alone", () => {
  /**
   * `@oxlint/plugins` is a devDependency, used for types. A runtime import of
   * it would resolve fine here — the workspace has it installed — and fail
   * with ERR_MODULE_NOT_FOUND in every consumer's project.
   */
  let outside: string;

  beforeAll(() => {
    ensureBuilt();
    outside = mkdtempSync(join(tmpdir(), "supergrain-oxlint-"));
  }, 120_000);

  afterAll(() => {
    rmSync(outside, { recursive: true, force: true });
  });

  it("has no runtime import of @oxlint/plugins", () => {
    const bundle = readFileSync(distFile, "utf8");
    expect(bundle).not.toMatch(/(?:from|import|require)\s*\(?\s*["']@oxlint\/plugins["']/u);
  });

  it("loads and reports from outside the workspace", () => {
    mkdirSync(join(outside, "plugin"));
    copyFileSync(distFile, join(outside, "plugin/index.js"));
    copyFileSync(fixtureFile, join(outside, "sample.tsx"));
    const config = join(outside, ".oxlintrc.json");
    writeFileSync(
      config,
      JSON.stringify({
        jsPlugins: ["./plugin/index.js"],
        plugins: [],
        categories: {},
        rules: { "supergrain/require-tracked": "error", "supergrain/no-async-batch": "error" },
      }),
    );

    const result = runOxlint(config, join(outside, "sample.tsx"), outside);
    expect(result).toContain("supergrain(require-tracked)");
    expect(result).toContain("supergrain(no-async-batch)");
  });
});
