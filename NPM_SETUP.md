# NPM Scoped Package Setup Guide

This guide explains how the `@supergrain` scoped packages are configured for NPM publishing and what steps you need to take to publish them.

## What is a Scoped Package?

Scoped packages in NPM use the format `@scope/package-name` (e.g., `@supergrain/core`). They:
- Provide namespace organization (all supergrain packages are under `@supergrain`)
- Can be public or private
- Require an NPM organization account

## Current Configuration

✅ **Already configured in this repository:**

1. **Package names** - All packages use the `@supergrain` scope:
   - `@supergrain/core` (packages/core/package.json)
   - `@supergrain/react` (packages/react/package.json)
   - `@supergrain/store` (packages/store/package.json)

2. **Public access** - All packages have `publishConfig.access: "public"` in their package.json files

3. **Root package marked as private** - The root package.json has `"private": true` to prevent it from being published (only scoped packages should be published)

4. **Changesets configuration** - `.changeset/config.json` has `"access": "public"`

5. **GitHub Actions workflow** - `.github/workflows/publish.yml` is configured to:
   - Build packages on every push to main
   - Create release PRs automatically
   - Publish to NPM when release PRs are merged
   - Use the `NPM_TOKEN` secret for authentication

## What You Need to Do

### Step 1: Create/Verify NPM Organization

1. Go to https://www.npmjs.com/
2. Log in to your NPM account
3. If you haven't created the organization yet:
   - Go to https://www.npmjs.com/org/create
   - Enter "supergrain" as the organization name
   - Choose "unlimited public packages" (free)
4. If the organization already exists, verify you have admin access

### Step 2: Create an NPM Automation Token

1. Log in to [npmjs.com](https://www.npmjs.com/)
2. Click your profile icon → **Access Tokens**
3. Click **"Generate New Token"** → Choose **"Automation"**
4. Configure the token:
   - **Token Type**: Automation (required for CI/CD)
   - **Permissions**: Read and Write (to publish packages)
   - **Organizations**: Ensure access to `@supergrain`
5. Click **"Generate Token"**
6. **IMPORTANT**: Copy the token immediately (you won't see it again)

### Step 3: Add NPM Token to GitHub Secrets

1. Go to your repository settings:
   ```
   https://github.com/commoncurriculum/supergrain/settings/secrets/actions
   ```
2. Click **"New repository secret"**
3. Configure the secret:
   - **Name**: `NPM_TOKEN` (exactly this - the workflow requires this name)
   - **Value**: Paste the automation token from Step 2
4. Click **"Add secret"**

### Step 4: Test the Setup

Once the token is added, the publishing workflow is ready! To test:

1. Make a small change to a package (or use the changeset workflow)
2. Create a changeset:
   ```bash
   pnpm changeset
   ```
   Or use the [GitHub UI workflow](https://github.com/commoncurriculum/supergrain/actions/workflows/add-changeset.yml)

3. Push to main (or merge a PR)
4. The GitHub Action will create a "Release: Version Packages" PR
5. Review and merge that PR
6. The packages will be automatically published to NPM! 🎉

## How Publishing Works

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Developer makes code changes                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Developer creates changeset (describes changes)           │
│    - Via `pnpm changeset` command                            │
│    - Or via GitHub Actions UI workflow                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Push to main branch                                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. GitHub Action runs (.github/workflows/publish.yml)       │
│    - Installs dependencies                                   │
│    - Builds all packages                                     │
│    - Runs changesets/action                                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Changeset creates "Release: Version Packages" PR         │
│    - Bumps version numbers                                   │
│    - Updates CHANGELOG.md files                              │
│    - Removes consumed changeset files                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Developer reviews and merges Release PR                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. GitHub Action publishes to NPM                            │
│    - Uses NPM_TOKEN for authentication                       │
│    - Publishes @supergrain/core, @supergrain/react, etc.    │
│    - Creates GitHub releases with changelogs                 │
└─────────────────────────────────────────────────────────────┘
```

## Troubleshooting

### Release Job Failing with 404 Error?

**If you're seeing NPM publish failures**, see the comprehensive debugging guide:
📖 **[TROUBLESHOOTING_RELEASE.md](TROUBLESHOOTING_RELEASE.md)** - Step-by-step diagnosis and fixes

### "402 Payment Required" Error

This means you're trying to publish a scoped package without the proper NPM organization setup or token permissions. Make sure:
- The `@supergrain` organization exists on NPM
- Your NPM token has access to publish to that organization
- The token is correctly added to GitHub secrets as `NPM_TOKEN`

### "403 Forbidden" Error

This means authentication failed or you don't have permission. Check:
- The `NPM_TOKEN` secret is correctly set in GitHub
- The token hasn't expired
- The token has "Read and Write" permissions
- You're an admin of the `@supergrain` organization

### "404 Not Found" Error When Publishing

This means NPM cannot access the `@supergrain` organization. Common causes:
- The NPM organization `@supergrain` doesn't exist (create it at https://www.npmjs.com/org/create)
- Your NPM token doesn't have access to the organization
- Your token is the wrong type (must be "Automation", not "Publish")
- Your token has expired

**See [TROUBLESHOOTING_RELEASE.md](TROUBLESHOOTING_RELEASE.md) for detailed steps to fix this.**

### "404 Not Found" When Installing

If users get 404 errors when trying to install, the packages might not be public. Verify:
- Each package.json has `"publishConfig": { "access": "public" }`
- The `.changeset/config.json` has `"access": "public"`
- The packages have been successfully published (check https://www.npmjs.com/package/@supergrain/core)

### Workflow Doesn't Run

If the GitHub Action doesn't trigger:
- Check that the workflow file exists at `.github/workflows/publish.yml`
- Verify you pushed to the `main` branch
- Check the Actions tab for any errors

## Manual Publishing (Emergency Only)

If you need to publish manually (not recommended):

```bash
# 1. Build all packages
pnpm -r --filter="@supergrain/*" build

# 2. Login to NPM (uses your personal token)
npm login

# 3. Publish each package
cd packages/core && npm publish
cd ../react && npm publish
cd ../store && npm publish
```

**Note**: Manual publishing bypasses the changeset workflow and won't update changelogs or create GitHub releases.

## Additional Resources

- [NPM Scoped Packages Documentation](https://docs.npmjs.com/about-scopes)
- [NPM Access Tokens Documentation](https://docs.npmjs.com/about-access-tokens)
- [Changesets Documentation](https://github.com/changesets/changesets)
- [GitHub Actions Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

## Need Help?

If you encounter issues:
1. Check the [GitHub Actions logs](https://github.com/commoncurriculum/supergrain/actions)
2. Review the [Troubleshooting section](#troubleshooting) above
3. Check NPM package pages to verify publishing status
4. Review the RELEASING.md file for step-by-step instructions
