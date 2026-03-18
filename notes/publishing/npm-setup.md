# NPM Scoped Package Setup

> **Status:** Reference guide for `@supergrain` scoped package configuration and NPM publishing infrastructure.

## What's a Scoped Package?

NPM scoped packages use `@scope/package-name` format (e.g., `@supergrain/core`). They provide namespace organization, can be public or private, and require an NPM organization account.

## Current Configuration

All of the following is already set up:

1. **Package names:** `@supergrain/core`, `@supergrain/react`, `@supergrain/store`
2. **Public access:** All packages have `publishConfig.access: "public"`
3. **Root private:** Root `package.json` has `"private": true`
4. **Changesets:** `.changeset/config.json` has `"access": "public"`
5. **CI/CD:** `.github/workflows/publish.yml` builds, creates release PRs, and publishes

## One-Time Setup

### Step 1: Create/Verify NPM Organization

1. Go to https://www.npmjs.com/ and log in
2. Create org at https://www.npmjs.com/org/create (name: "supergrain", free plan)
3. Or verify you have admin access to existing org

### Step 2: Create NPM Automation Token

1. Profile -> Access Tokens -> Generate New Token -> "Automation" type
2. Permissions: Read and Write, with `@supergrain` org access
3. Copy the token immediately

### Step 3: Add Token to GitHub Secrets

1. Go to `https://github.com/commoncurriculum/supergrain/settings/secrets/actions`
2. New repository secret: `NPM_TOKEN` = your automation token

### Step 4: Test

```bash
pnpm changeset   # or use the GitHub UI workflow
# Commit, push to main
# Wait for "Release: Version Packages" PR
# Merge -> packages publish automatically
```

## Publishing Flow

```
Developer makes changes
    |
    v
Developer creates changeset (pnpm changeset or GitHub UI)
    |
    v
Push to main
    |
    v
GitHub Action runs (.github/workflows/publish.yml)
    |
    v
Changesets creates "Release: Version Packages" PR
  (bumps versions, updates CHANGELOGs, removes changeset files)
    |
    v
Developer merges Release PR
    |
    v
GitHub Action publishes to NPM + creates GitHub releases
```

## Troubleshooting

| Error                       | Cause                            | Fix                                                             |
| --------------------------- | -------------------------------- | --------------------------------------------------------------- |
| **402 Payment Required**    | Missing org or token permissions | Verify @supergrain org exists, token has org access             |
| **403 Forbidden**           | Auth failure                     | Check NPM_TOKEN secret, expiration, R/W permissions             |
| **404 Not Found** (install) | Not public                       | Verify `publishConfig.access: "public"` in each package.json    |
| **Workflow doesn't run**    | Missing file or wrong branch     | Check `.github/workflows/publish.yml` exists, push is to `main` |

## Manual Publishing (Emergency Only)

```bash
pnpm -r --filter="@supergrain/*" build
npm login
cd packages/core && npm publish
cd ../react && npm publish
cd ../store && npm publish
```

This bypasses changesets and won't update changelogs or create GitHub releases.

## Resources

- [NPM Scoped Packages](https://docs.npmjs.com/about-scopes)
- [NPM Access Tokens](https://docs.npmjs.com/about-access-tokens)
- [Changesets](https://github.com/changesets/changesets)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
