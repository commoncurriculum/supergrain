# How to Create a Release and Publish to NPM

This project uses [Changesets](https://github.com/changesets/changesets) to manage releases. Changesets automates versioning, changelog generation, and publishing to NPM.

## One-Time Setup

**Set up NPM_TOKEN secret in GitHub** (if not already done):

1. Go to [npmjs.com](https://www.npmjs.com/) and create an "Automation" token
2. Add it to GitHub repository secrets:
   - Go to https://github.com/commoncurriculum/supergrain/settings/secrets/actions
   - Create a new secret named `NPM_TOKEN`
   - Paste your NPM token

## How to Release (Simple!)

### Step 1: Add a Changeset

You have two options for creating a changeset:

#### Option A: GitHub UI (No terminal needed!)

1. Go to the [Add Changeset workflow](https://github.com/commoncurriculum/supergrain/actions/workflows/add-changeset.yml)
2. Click "Run workflow"
3. Fill in the form:
   - **Packages**: Enter `all` or comma-separated list like `core, react`
   - **Version bump type**: Choose `patch`, `minor`, or `major`
   - **Changelog message**: Describe your changes
4. Click "Run workflow"
5. The workflow creates a PR with the changeset - review and merge it!

#### Option B: Local Terminal

```bash
pnpm changeset
```

This interactive CLI will ask you:
1. **Which packages to release?** Select the packages you changed
2. **What type of change?** Choose:
   - **major** - Breaking changes (e.g., v1.0.0 → v2.0.0)
   - **minor** - New features (e.g., v1.0.0 → v1.1.0)
   - **patch** - Bug fixes (e.g., v1.0.0 → v1.0.1)
3. **Summary** - Describe your changes (becomes the changelog entry)

This creates a small markdown file in `.changeset/` that describes your changes.

### Step 2: Commit and Push

```bash
git add .
git commit -m "Add feature X"
git push origin main
```

### Step 3: Merge the Release PR

When you push to `main`, the GitHub Action automatically:

1. **Creates a "Release: Version Packages" PR** that:
   - Updates version numbers in package.json
   - Generates/updates CHANGELOG.md files
   - Removes the changeset files

2. **When you merge this PR**, it automatically:
   - Publishes all updated packages to NPM
   - Creates GitHub releases with changelogs

That's it! No manual version bumping, no manual publishing, no manual changelog writing.

## Example Workflow

### Using GitHub UI (Easiest!)

1. Make your changes and push to a branch
2. Go to [Actions → Add Changeset](https://github.com/commoncurriculum/supergrain/actions/workflows/add-changeset.yml)
3. Click "Run workflow"
   - Packages: `core`
   - Bump: `minor`
   - Message: `Add support for nested array updates`
4. Merge the changeset PR
5. Wait for the "Release: Version Packages" PR to be created
6. Review and merge it → packages publish automatically!

### Using Terminal

```bash
# Make your changes to code
vim packages/core/src/store.ts

# Create a changeset
pnpm changeset
# Select: @supergrain/core
# Type: minor (new feature)
# Summary: "Add support for nested array updates"

# Commit and push
git add .
git commit -m "feat: Add nested array update support"
git push origin main

# Wait for GitHub Action to create a "Release: Version Packages" PR
# Review the PR to see the version bumps and changelog
# Merge the PR → packages automatically publish to NPM!
```

## Manual Publishing (if needed)

If you need to publish manually (not recommended):

```bash
# Build all packages
pnpm -r --filter="@supergrain/*" build

# Bump versions and generate changelogs
pnpm version-packages

# Publish to NPM
pnpm release
```

## Multiple Changes Between Releases

You can create multiple changesets before releasing:

```bash
# Fix a bug
pnpm changeset  # Select patch for @supergrain/react

# Add a feature
pnpm changeset  # Select minor for @supergrain/core

# Make breaking change
pnpm changeset  # Select major for @supergrain/store
```

All changesets will be combined into a single release PR.

## Troubleshooting

**"No changeset files found"**: You need to run `pnpm changeset` first to describe your changes.

**NPM publish fails**: Check that `NPM_TOKEN` secret is set correctly in GitHub settings.

**Wrong version bump**: Edit or delete the changeset file in `.changeset/` and create a new one.

## Learn More

- [Changesets Documentation](https://github.com/changesets/changesets)
- [Semantic Versioning](https://semver.org/)
