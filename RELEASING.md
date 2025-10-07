# How to Create a Release and Publish to NPM

This document explains how to create a release for Supergrain packages and publish them to NPM.

## Prerequisites

Before creating a release, you need to:

1. **Set up NPM_TOKEN secret in GitHub**:
   - Go to [npmjs.com](https://www.npmjs.com/) and log in
   - Navigate to your account settings > Access Tokens
   - Create a new "Automation" token
   - Copy the token
   - Go to your GitHub repository: https://github.com/commoncurriculum/supergrain
   - Navigate to Settings > Secrets and variables > Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: paste your NPM token
   - Click "Add secret"

2. **Ensure you have permissions**:
   - You must be a collaborator on the GitHub repository
   - You must be a maintainer/owner of the NPM packages (@supergrain/core, @supergrain/react, @supergrain/store)

## Release Process

### 1. Update Package Versions

Before creating a release, update the version numbers in the package.json files:

```bash
# Update version in packages/core/package.json
# Update version in packages/react/package.json
# Update version in packages/store/package.json
```

Make sure to follow [Semantic Versioning](https://semver.org/):
- MAJOR version for incompatible API changes
- MINOR version for new functionality in a backward-compatible manner
- PATCH version for backward-compatible bug fixes

### 2. Commit and Push Version Changes

```bash
git add packages/*/package.json
git commit -m "Bump version to X.Y.Z"
git push origin main
```

### 3. Create a Git Tag

```bash
# Create and push a tag matching the version
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

### 4. Create a GitHub Release

#### Option A: Using GitHub Web Interface (Recommended)

1. Go to https://github.com/commoncurriculum/supergrain/releases
2. Click "Draft a new release"
3. Click "Choose a tag" and select the tag you just created (or create a new one)
4. Enter a release title (e.g., "v0.1.0")
5. Add release notes describing:
   - New features
   - Bug fixes
   - Breaking changes
   - Any other important information
6. Click "Publish release"

#### Option B: Using GitHub CLI

```bash
# Install GitHub CLI if you haven't: https://cli.github.com/

# Create a release
gh release create v0.1.0 \
  --title "v0.1.0" \
  --notes "Release notes here"
```

## What Happens Next

Once you create a release:

1. The GitHub Action workflow (`.github/workflows/publish.yml`) will be automatically triggered
2. The workflow will:
   - Check out the code
   - Install dependencies with pnpm
   - Build all three packages (@supergrain/core, @supergrain/react, @supergrain/store)
   - Publish each package to NPM with public access
3. You can monitor the progress at: https://github.com/commoncurriculum/supergrain/actions

## Troubleshooting

### Workflow Fails with Authentication Error

- Verify the `NPM_TOKEN` secret is set correctly in GitHub repository settings
- Check that your NPM token has "Automation" type permissions
- Ensure your NPM token hasn't expired

### Package Already Published Error

- You cannot republish the same version to NPM
- Increment the version number in package.json and create a new release

### Build Fails

- Check the GitHub Actions logs for specific errors
- Ensure all tests pass before creating a release: `pnpm test`
- Ensure all packages build successfully: `pnpm -r --filter="@supergrain/*" build`

## Version Management

For consistency, it's recommended to keep the version numbers synchronized across all three packages. However, if you need to publish only specific packages, you can:

1. Update only the version in specific package.json files
2. Modify the `.github/workflows/publish.yml` to publish only the packages you want
3. Create a release as normal

## Best Practices

1. **Test before releasing**: Always run `pnpm test` and `pnpm run typecheck` before creating a release
2. **Update CHANGELOG**: Keep a CHANGELOG.md file with release notes
3. **Use semantic versioning**: Follow semver guidelines for version numbers
4. **Write clear release notes**: Help users understand what changed
5. **Tag commits**: Always create a git tag for releases for traceability
