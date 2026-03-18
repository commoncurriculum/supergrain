# How to Release

> **Status:** Step-by-step release instructions using Changesets.

## Prerequisites (One-Time)

1. `@supergrain` organization exists on [npmjs.com](https://www.npmjs.com/)
2. NPM Automation token created (Profile -> Access Tokens -> Automation type, R/W permissions)
3. Token added to GitHub: Settings -> Secrets -> `NPM_TOKEN`

See [npm-setup.md](npm-setup.md) for detailed setup instructions.

## Release Process

### Step 1: Add a Changeset

**Option A: GitHub UI** (no terminal needed)

1. Go to [Add Changeset workflow](https://github.com/commoncurriculum/supergrain/actions/workflows/add-changeset.yml)
2. Click "Run workflow"
3. Fill in: packages (`all` or `core, react`), bump type (`patch`/`minor`/`major`), message
4. Merge the resulting PR

**Option B: Terminal**

```bash
pnpm changeset
# Select packages, choose bump type, write summary
git add . && git commit -m "Add changeset" && git push
```

### Step 2: Merge the Release PR

When you push to `main`, GitHub Actions automatically:

1. Creates a "Release: Version Packages" PR that bumps versions, generates changelogs, removes changeset files
2. When merged, publishes all updated packages to NPM and creates GitHub releases

That's it.

## Multiple Changes Between Releases

Create multiple changesets before releasing -- they combine into a single release PR:

```bash
pnpm changeset  # patch for @supergrain/react (bug fix)
pnpm changeset  # minor for @supergrain/core (new feature)
pnpm changeset  # major for @supergrain/store (breaking change)
```

## Version Bump Types

| Type    | When             | Example        |
| ------- | ---------------- | -------------- |
| `patch` | Bug fixes        | 1.0.0 -> 1.0.1 |
| `minor` | New features     | 1.0.0 -> 1.1.0 |
| `major` | Breaking changes | 1.0.0 -> 2.0.0 |

## Manual Publishing (Emergency)

```bash
pnpm -r --filter="@supergrain/*" build
pnpm version-packages
pnpm release
```

## Troubleshooting

| Issue                      | Fix                                                      |
| -------------------------- | -------------------------------------------------------- |
| "No changeset files found" | Run `pnpm changeset` first                               |
| NPM publish fails          | Check `NPM_TOKEN` secret in GitHub settings              |
| Wrong version bump         | Delete changeset file in `.changeset/`, create a new one |

## Resources

- [Changesets Documentation](https://github.com/changesets/changesets)
- [Semantic Versioning](https://semver.org/)
