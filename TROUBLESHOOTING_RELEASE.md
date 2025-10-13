# Release Job Troubleshooting Guide

This guide helps you debug and fix issues with the NPM publishing workflow.

## Current Issue: 404 Not Found Error

If you're seeing this error:
```
npm error 404 Not Found - PUT https://registry.npmjs.org/@supergrain%2fcore
npm error 404 The requested resource '@supergrain/core@0.1.0' could not be found or you do not have permission to access it.
```

This means the publish step is failing because NPM cannot access the `@supergrain` organization.

## Quick Diagnosis Steps

### Step 1: Check if the NPM Organization Exists

1. Visit https://www.npmjs.com/org/supergrain
2. **If you see a 404 error**: The organization doesn't exist. You need to create it.
3. **If you see the organization page**: The organization exists. Continue to Step 2.

### Step 2: Verify Your NPM Organization Access

1. Log in to https://www.npmjs.com/
2. Click on your profile picture → **Organizations**
3. Find `@supergrain` in the list
4. Click on it to view members
5. **Verify**: You should see yourself as an owner or admin

**If you don't have access:**
- Contact the organization owner to add you as a member with publish permissions

### Step 3: Check Your NPM Token Configuration

The token needs to meet specific requirements:

#### 3a. Verify Token Type
1. Go to https://www.npmjs.com/settings/[YOUR_USERNAME]/tokens
2. Look for your token in the list
3. **Required**: Token type must be **"Automation"** (not "Publish" or "Read Only")

#### 3b. Verify Token Permissions
The token must have:
- ✅ **Read and Write** permissions
- ✅ Access to the `@supergrain` organization
- ✅ Not expired (check the expiration date)

**If your token doesn't meet these requirements:**
1. Delete the old token
2. Create a new **Automation** token
3. Ensure it has **Read and Write** permissions
4. Ensure it has access to `@supergrain` organization
5. Copy the token (you won't see it again!)

### Step 4: Update GitHub Secret

1. Go to https://github.com/commoncurriculum/supergrain/settings/secrets/actions
2. Find the `NPM_TOKEN` secret
3. Click **Update** (or **New repository secret** if it doesn't exist)
4. Paste your new automation token
5. Click **Update secret** (or **Add secret**)

### Step 5: Test the Fix

After updating the token:

1. Go to https://github.com/commoncurriculum/supergrain/actions/workflows/publish.yml
2. Click **Run workflow**
3. Select branch: `main`
4. Click **Run workflow**
5. Monitor the workflow to see if it succeeds

## Common Issues and Solutions

### Issue: "Organization doesn't exist"

**Solution**: Create the NPM organization
1. Go to https://www.npmjs.com/org/create
2. Enter `supergrain` as the organization name
3. Complete the creation process
4. Go back to Step 2 above to set up your token

### Issue: "You don't have permission"

**Causes**:
- You're not a member of the `@supergrain` organization
- Your token doesn't have access to the organization
- Your token type is wrong (needs to be "Automation")

**Solution**: 
- For access issues: Contact the organization owner
- For token issues: Create a new Automation token with correct permissions

### Issue: "Token expired"

NPM tokens can expire. Starting October 13, 2025, new tokens have a maximum lifetime of 90 days.

**Solution**: 
1. Create a new Automation token
2. Update the GitHub secret with the new token

### Issue: "No changesets found"

This is not an error! It means:
- The workflow ran successfully but found no changes to publish
- This happens when there are no new changesets in `.changeset/` directory

**What happens**: The workflow will attempt to publish any unpublished packages.

**If you want to create a release**:
1. Run `pnpm changeset` to create a changeset
2. Commit and push the changeset
3. Wait for the "Release: Version Packages" PR to be created
4. Merge that PR to trigger the publish

## Debugging Commands

You can also test your NPM token locally:

```bash
# Set the token (replace YOUR_TOKEN with your actual token)
echo "//registry.npmjs.org/:_authToken=YOUR_TOKEN" > ~/.npmrc

# Test if you can access the organization
npm access ls-packages @supergrain

# Try a dry-run publish (doesn't actually publish)
cd packages/core
npm publish --dry-run
```

**Expected output**: You should see the package details without errors.

**If you see errors**: The token doesn't have the right permissions.

## Still Having Issues?

If you've followed all these steps and still see errors:

1. Check the full workflow logs:
   - Go to https://github.com/commoncurriculum/supergrain/actions
   - Click on the failed run
   - Click on the "Release" job
   - Expand the "Create Release Pull Request or Publish to NPM" step
   - Look for any additional error messages

2. Common additional issues:
   - **Network issues**: Temporary NPM registry problems (retry later)
   - **Package name conflict**: Someone else published to `@supergrain/core` first
   - **GitHub token issues**: The `GITHUB_TOKEN` might not have write permissions

3. Ask for help:
   - Include the full error message from the workflow logs
   - Mention which steps you've already tried from this guide
   - Note whether you can successfully run `npm access ls-packages @supergrain` locally

## Reference Documentation

- **[NPM_SETUP.md](NPM_SETUP.md)** - Initial setup instructions
- **[NPM_PUBLISHING_CHECKLIST.md](NPM_PUBLISHING_CHECKLIST.md)** - Pre-publish checklist
- **[RELEASING.md](RELEASING.md)** - How to create releases
- **[NPM Tokens Documentation](https://docs.npmjs.com/about-access-tokens)** - Official NPM docs
