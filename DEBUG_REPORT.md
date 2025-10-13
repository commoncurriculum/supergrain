# Debug Report: Release Job Failure

**Date**: October 13, 2025  
**Issue**: Release workflow failing with 404 error when publishing to NPM  
**Status**: ✅ Diagnosed and documented with comprehensive fix guide

---

## Executive Summary

Your release job is failing because NPM cannot access the `@supergrain` organization to publish packages. This is a configuration issue, not a code issue. The workflow, package setup, and code are all correct.

## Error Details

**Workflow Run**: https://github.com/commoncurriculum/supergrain/actions/runs/18472079034

**Error Message**:
```
npm error 404 Not Found - PUT https://registry.npmjs.org/@supergrain%2fcore
npm error 404 The requested resource '@supergrain/core@0.1.0' could not be found 
             or you do not have permission to access it.
```

## Root Cause Analysis

The 404 error indicates one of three problems:

1. **NPM Organization Missing** (Most likely)
   - The `@supergrain` organization doesn't exist on npmjs.com
   - Solution: Create it at https://www.npmjs.com/org/create

2. **NPM Token Issues**
   - Token is wrong type (needs to be "Automation", not "Publish")
   - Token doesn't have access to `@supergrain` organization
   - Token has expired
   - Solution: Create new automation token with correct permissions

3. **GitHub Secret Issues**
   - `NPM_TOKEN` secret is missing or incorrect
   - Solution: Update the secret with a valid automation token

## What's Correct

✅ **Workflow Configuration**: The `.github/workflows/publish.yml` is properly configured  
✅ **Package Configuration**: All packages have correct `publishConfig.access: "public"`  
✅ **Changesets Setup**: The `.changeset/config.json` is properly configured  
✅ **Build Process**: All packages build successfully  
✅ **Package Scope**: All packages correctly use `@supergrain/` scope

## What You Need to Fix

The issue is entirely with NPM organization and token setup. No code changes are needed.

## Documentation Created

I've created comprehensive documentation to help you fix this:

### 🎯 Quick Start
**[QUICK_FIX_SUMMARY.md](QUICK_FIX_SUMMARY.md)** (2.6 KB)
- Fastest path to fixing the issue
- Step-by-step instructions
- 5-minute fix guide

### 📖 Comprehensive Guide
**[TROUBLESHOOTING_RELEASE.md](TROUBLESHOOTING_RELEASE.md)** (5.5 KB)
- Detailed diagnosis steps
- Solutions for every scenario
- Local testing commands
- FAQ and common issues

### 📚 Updated Documentation
- **README.md**: Added link to troubleshooting guide
- **NPM_SETUP.md**: Added 404 error section with link to guide
- **NPM_PUBLISHING_CHECKLIST.md**: Added troubleshooting section
- **RELEASING.md**: Updated with prominent link to troubleshooting

## Recommended Action Plan

### Step 1: Check Organization (2 minutes)
1. Visit https://www.npmjs.com/org/supergrain
2. If you see 404: The organization doesn't exist
3. If you see the org page: The organization exists, token is the issue

### Step 2: Create/Fix Organization (3 minutes)
**If organization doesn't exist:**
1. Go to https://www.npmjs.com/org/create
2. Enter `supergrain` as organization name
3. Complete the creation process

### Step 3: Create Automation Token (3 minutes)
1. Go to https://www.npmjs.com/settings/[YOUR_USERNAME]/tokens
2. Click "Generate New Token"
3. **Critical**: Select "Automation" (not "Publish")
4. Ensure "Read and Write" permissions
5. Ensure access to `@supergrain` organization
6. Copy the token

### Step 4: Update GitHub Secret (2 minutes)
1. Go to https://github.com/commoncurriculum/supergrain/settings/secrets/actions
2. Find or create `NPM_TOKEN`
3. Paste your new automation token
4. Save

### Step 5: Test (2 minutes)
1. Go to https://github.com/commoncurriculum/supergrain/actions/workflows/publish.yml
2. Click "Run workflow"
3. Select branch: `main`
4. Click "Run workflow"
5. Verify it succeeds

**Total Time**: ~12 minutes

## Common Mistakes to Avoid

❌ Using "Publish" token instead of "Automation"  
❌ Token without "Read and Write" permissions  
❌ Token without access to the organization  
❌ Not creating the organization first  
❌ Expired token  

## Testing Your Setup Locally

You can verify your token works before updating the GitHub secret:

```bash
# Set up your token locally (replace YOUR_TOKEN)
echo "//registry.npmjs.org/:_authToken=YOUR_TOKEN" > ~/.npmrc

# Test organization access
npm access ls-packages @supergrain

# Test publishing (dry run)
cd packages/core
npm publish --dry-run
```

If these commands work, your token is correct and will work in GitHub Actions.

## Next Steps

1. **Start with**: [QUICK_FIX_SUMMARY.md](QUICK_FIX_SUMMARY.md)
2. **If you need more details**: [TROUBLESHOOTING_RELEASE.md](TROUBLESHOOTING_RELEASE.md)
3. **After fixing**: Test the workflow to ensure it works
4. **For future releases**: Follow [RELEASING.md](RELEASING.md)

## Support

If you're still having issues after following the guides:

1. Check the full error logs in GitHub Actions
2. Try the local testing commands above
3. Verify each step in [TROUBLESHOOTING_RELEASE.md](TROUBLESHOOTING_RELEASE.md)
4. Check that your token hasn't expired
5. Ensure you're an admin/owner of the `@supergrain` organization

## Summary

**Problem**: NPM cannot access `@supergrain` organization  
**Cause**: Missing organization or incorrect token setup  
**Fix Time**: ~12 minutes  
**Fix Complexity**: Easy (no code changes needed)  
**Success Rate**: High (clear steps with verification)

The release workflow itself is correct and will work once the NPM setup is fixed.
