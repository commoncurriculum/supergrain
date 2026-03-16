# NPM Publishing Checklist

This checklist will help you get your `@supergrain` packages published to NPM.

## ✅ Already Configured (No Action Needed)

The repository is already configured with:

- ✅ **Scoped package names**: `@supergrain/core`, `@supergrain/react`, `@supergrain/store`
- ✅ **Public access configuration**: All packages have `publishConfig.access: "public"`
- ✅ **Root package marked private**: Root `package.json` has `"private": true` to prevent publishing
- ✅ **Changesets configuration**: `.changeset/config.json` is properly configured
- ✅ **GitHub Actions workflow**: `.github/workflows/publish.yml` is ready to publish
- ✅ **Package exports**: All packages properly configured with ESM/CJS exports
- ✅ **Build configuration**: Packages build successfully with TypeScript types

## 🔧 What You Need to Do

Follow these steps to complete the NPM publishing setup:

### Step 1: Create or Access NPM Organization

- [ ] Log in to https://www.npmjs.com/
- [ ] Verify the `@supergrain` organization exists or create it at https://www.npmjs.com/org/create
- [ ] Ensure you have admin/owner access to the organization

### Step 2: Create NPM Automation Token

- [ ] Go to your NPM profile → **Access Tokens**
- [ ] Click **"Generate New Token"** → Select **"Automation"** type
- [ ] Ensure the token has:
  - ✓ **Read and Write** permissions
  - ✓ Access to the `@supergrain` organization
- [ ] Copy the token (you won't see it again!)

### Step 3: Add Token to GitHub

- [ ] Go to https://github.com/commoncurriculum/supergrain/settings/secrets/actions
- [ ] Click **"New repository secret"**
- [ ] Name: `NPM_TOKEN` (exactly this name)
- [ ] Value: Paste your automation token
- [ ] Click **"Add secret"**

### Step 4: Test Publishing

- [ ] Create a test changeset:
  ```bash
  pnpm changeset
  # Select: all packages
  # Type: patch
  # Summary: "Initial NPM publication setup"
  ```
- [ ] Commit and push to main
- [ ] Wait for GitHub Actions to create a "Release: Version Packages" PR
- [ ] Review the PR (check version bumps and changelogs)
- [ ] Merge the PR
- [ ] Verify packages appear on NPM:
  - https://www.npmjs.com/package/@supergrain/core
  - https://www.npmjs.com/package/@supergrain/react
  - https://www.npmjs.com/package/@supergrain/store

## 📚 Reference Documentation

- **[NPM_SETUP.md](NPM_SETUP.md)** - Comprehensive setup guide with troubleshooting
- **[RELEASING.md](RELEASING.md)** - Step-by-step release instructions
- **[README.md](README.md)** - Main project documentation

## 🆘 Troubleshooting

If something goes wrong, check:

1. **GitHub Actions tab** - View workflow logs for errors
2. **NPM organization** - Verify you have correct permissions
3. **Token expiration** - Check if your NPM token is still valid
4. **NPM_SETUP.md** - Review the troubleshooting section

Common issues and solutions are documented in [NPM_SETUP.md](NPM_SETUP.md#troubleshooting).

## 🎉 Success!

Once you complete these steps, your packages will be published to NPM and anyone can install them with:

```bash
npm install @supergrain/core @supergrain/react @supergrain/store
```

Future releases will be automatic - just create changesets and merge the release PRs!
