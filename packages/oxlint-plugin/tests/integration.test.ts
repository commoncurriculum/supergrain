import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * `RuleTester` calls each rule's `create()` directly. That proves the rule
 * logic, but not that the plugin *loads* — that it exports the shape oxlint
 * expects, that `jsPlugins` resolves it, and that the rule ids in a config
 * actually match. Those break independently of the rules, and silently: a
 * plugin that fails to register simply reports nothing.
 *
 * So this runs the real oxlint binary over a fixture with known defects and
 * asserts each one is reported.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureConfig = join(packageRoot, "tests/fixtures/.oxlintrc.json");
const fixtureFile = join(packageRoot, "tests/fixtures/sample.tsx");

function runOxlint(): string {
  try {
    return execFileSync(
      join(packageRoot, "node_modules/.bin/oxlint"),
      ["-c", fixtureConfig, fixtureFile],
      { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    // oxlint exits non-zero when it reports errors, which is the expected path.
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
  }
}

describe("plugin loads in a real oxlint run", () => {
  let output: string;

  beforeAll(() => {
    // oxlint loads the built plugin, not the TS source: Node's ESM resolver
    // can't map the `.js` specifiers in our TS files onto `.ts` files. Build on
    // demand so this test works from a bare checkout and from the root test
    // run, not only after `pnpm build`.
    if (!existsSync(join(packageRoot, "dist/index.js"))) {
      execFileSync(join(packageRoot, "node_modules/.bin/vite"), ["build"], {
        cwd: packageRoot,
        stdio: "ignore",
      });
    }
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
