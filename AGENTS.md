# Agent Instructions

This document provides instructions for AI agents working in this repository.

## Package Manager

This project uses `pnpm` for package management. Do not use `npm` or `yarn`. All package installation, removal, or script execution should be done using `pnpm`.

**Examples:**

- `pnpm install`
- `pnpm add <package-name>`
- `pnpm run <script-name>`

## Releases

Releases are driven by [Changesets](https://github.com/changesets/changesets) and
published automatically by CI. **You never run `npm publish` or `pnpm release`
by hand** — the workflow in `.github/workflows/publish.yml` does it on `main`.

### The flow

1. **Add a changeset.** A change that should ship adds a `.changeset/*.md` file with
   frontmatter listing each package and its bump (`patch` / `minor` / `major`),
   followed by the changelog prose. Create it with `pnpm changeset`, by hand, or via
   the **Add Changeset** workflow (`.github/workflows/add-changeset.yml`, run from the
   Actions tab). Multiple changesets accumulate on `main`.
2. **CI opens a release PR.** On every push to `main`, the **Release** workflow runs
   `changesets/action`. While pending changesets exist it opens/updates a PR titled
   **"Release: Version Packages"** on branch `changeset-release/main`. That PR consumes
   the changeset files, bumps versions in each `package.json`, and writes each
   package's `CHANGELOG.md`. It updates itself automatically as more changesets land —
   you do **not** need to run `changeset version` locally.
3. **Cut the release = merge that PR.** Merging "Release: Version Packages" into `main`
   leaves no pending changesets, so the next Release run publishes instead of
   re-opening the PR. Publishing runs `pnpm run build` (root `build` script) then
   `pnpm release` (`pnpm -r publish`), which rewrites `workspace:*` deps to real
   versions. Then `.github/scripts/create-github-releases.mjs` tags each newly-live
   `@supergrain/*` version and creates a GitHub Release from its `CHANGELOG.md`.

**So to cut a release: make sure the changeset(s) are on `main`, then merge the open
"Release: Version Packages" PR.** Everything downstream is automatic.

### npm auth (trusted publishing / OIDC)

There is **no `NPM_TOKEN`**. Publishing uses npm **trusted publishing** — the job's
`id-token: write` permission lets npm mint a short-lived, repo-scoped credential, and
provenance attestations are generated automatically (`NPM_CONFIG_PROVENANCE: true`).
This requires **each published package to have a Trusted Publisher configured at
npmjs.com** pointing at `commoncurriculum/supergrain` + `publish.yml`.

### Publishing a brand-new package

When adding a package that should be published (e.g. a new `@supergrain/*`), wire it up
so the automated flow picks it up:

- Add its filter to the root **`build`** script in `package.json` (dist is gitignored,
  so CI must build it before publish).
- Do **not** add it to `ignore` in `.changeset/config.json`. Leave it out of the
  `fixed` group unless it must version in lockstep with the core packages — a new
  package normally starts at its own version (e.g. `0.0.0` → `0.1.0` from a `minor`
  changeset).
- Set `"publishConfig": { "access": "public" }` in its `package.json`.
- **Configure a Trusted Publisher for the new package name on npmjs.com** before the
  first publish, or the OIDC publish step will fail — this is a manual npmjs.com step
  that cannot be done from the repo. The GitHub Release step needs no setup;
  `create-github-releases.mjs` already covers every non-private `@supergrain/*` package.

## Pre-Push Verification

Before committing or pushing changes, run the same checks as CI when feasible:

- `pnpm run format:check`
- `pnpm run lint`
- `pnpm run build`
- `pnpm run typecheck`
- `pnpm run coverage` or `pnpm test`
- `pnpm run test:validate` when README/docs examples changed

If you intentionally skip any check, mention it in the final response with the reason.

## Documentation Test Requirements

### DOC_TEST Identifiers

Each TypeScript code block in the README.md must have a unique `DOC_TEST_` identifier and a corresponding test:

1. **Unique Identifiers**: Each code block must use a unique identifier like `// [#DOC_TEST_1]`, `// [#DOC_TEST_2]`, etc.
2. **One-to-One Mapping**: Each `DOC_TEST_` identifier in README.md must map to exactly one test case in the documentation package.
3. **Sequential Numbering**: Use the next available number when adding new DOC_TEST identifiers. Check existing numbers with:
   ```bash
   grep -o "DOC_TEST_[0-9]*" README.md | sed 's/DOC_TEST_//' | sort -n | tail -1
   ```

### Adding New Documentation Tests

When adding a new code example to README.md:

1. **Add the identifier**: Include `// [#DOC_TEST_XX](packages/documentation/tests/appropriate-test-file.ts)` at the top of the code block
2. **Create the test**: Add a corresponding test case in the appropriate test file:
   ```typescript
   it("#DOC_TEST_XX", () => {
     // Test implementation that matches the README example
   });
   ```
3. **Validate**: Run `pnpm test:validate` to ensure all DOC_TEST identifiers have corresponding tests

### Validation Commands

- **Documentation validation**: `pnpm test:validate` - Checks that all README code blocks have DOC_TEST identifiers and corresponding tests
- **Type checking**: `pnpm run typecheck` - Validates TypeScript types across all packages
- **Full test suite**: `pnpm test` - Runs all tests (requires Playwright for browser tests)

### Test File Locations

- Core functionality examples: `packages/documentation/tests/readme-core.test.ts`
- React integration examples: `packages/documentation/tests/readme-react.test.tsx`
- Complex examples: `packages/documentation/tests/readme-examples.test.tsx`
- App Store examples: Tests are typically in `readme-examples.test.tsx`
