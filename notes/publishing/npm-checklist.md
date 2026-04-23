# NPM Publishing Checklist

> **Status:** Setup guide. Follow these steps to publish `@supergrain` packages to NPM for the first time.

## Already Configured

- Scoped package names: `@supergrain/kernel`, `@supergrain/kernel/react`, `@supergrain/store`
- Public access: all packages have `publishConfig.access: "public"`
- Root package marked private (prevents accidental publish)
- Changesets configuration (`.changeset/config.json`)
- GitHub Actions workflow (`.github/workflows/publish.yml`)
- Package exports (ESM/CJS) and TypeScript types

## Steps

### 1. Create or Access NPM Organization

- Log in to https://www.npmjs.com/
- Verify `@supergrain` org exists or create it at https://www.npmjs.com/org/create
- Ensure admin/owner access

### 2. Create NPM Automation Token

- Profile -> Access Tokens -> Generate New Token -> "Automation" type
- Permissions: Read and Write
- Scope: `@supergrain` organization
- Copy the token immediately

### 3. Add Token to GitHub

- Go to `https://github.com/commoncurriculum/supergrain/settings/secrets/actions`
- New repository secret: Name = `NPM_TOKEN`, Value = your token

### 4. Test Publishing

```bash
pnpm changeset
# Select: all packages, Type: patch, Summary: "Initial NPM publication setup"
```

- Commit and push to main
- Wait for "Release: Version Packages" PR
- Review and merge
- Verify packages at:
  - https://www.npmjs.com/package/@supergrain/kernel
  - https://www.npmjs.com/package/@supergrain/kernel/react
  - https://www.npmjs.com/package/@supergrain/store

## Troubleshooting

| Error                   | Cause                                | Fix                                      |
| ----------------------- | ------------------------------------ | ---------------------------------------- |
| 402 Payment Required    | Missing NPM org or token permissions | Verify org + token access                |
| 403 Forbidden           | Auth failure                         | Check NPM_TOKEN secret, token expiration |
| 404 Not Found (install) | Package not public                   | Verify `publishConfig.access: "public"`  |

See [npm-setup.md](npm-setup.md) and [releasing.md](releasing.md) for detailed guides.

## After Setup

Future releases are automatic: create changesets, merge the release PR, packages publish.

```bash
npm install @supergrain/kernel @supergrain/kernel/react @supergrain/store
```
