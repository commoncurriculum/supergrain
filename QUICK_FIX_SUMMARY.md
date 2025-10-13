# Quick Fix Summary - Release Job Failure

## What's Wrong?

Your release job is failing with this error:
```
npm error 404 Not Found - PUT https://registry.npmjs.org/@supergrain%2fcore
```

## What This Means

NPM cannot access the `@supergrain` organization to publish packages. This is **not a code issue** - it's a configuration issue with your NPM setup.

## What You Need to Do

### Option 1: Quick Check (5 minutes)

1. **Visit**: https://www.npmjs.com/org/supergrain
   - If you see 404: The organization doesn't exist → Go to Option 2
   - If you see the org: The token is wrong → Go to Option 3

### Option 2: Create the NPM Organization (if it doesn't exist)

1. Go to https://www.npmjs.com/org/create
2. Enter `supergrain` as the organization name
3. Complete the creation
4. Then proceed to Option 3 to set up your token

### Option 3: Fix Your NPM Token

The issue is likely that your NPM token is missing, wrong type, or doesn't have access.

**Quick fix:**

1. **Create a NEW token**:
   - Go to https://www.npmjs.com/settings/[YOUR_USERNAME]/tokens
   - Click "Generate New Token"
   - Select **"Automation"** (this is critical!)
   - Ensure it has **Read and Write** permissions
   - Ensure it has access to the `@supergrain` organization
   - Copy the token (you won't see it again!)

2. **Update GitHub Secret**:
   - Go to https://github.com/commoncurriculum/supergrain/settings/secrets/actions
   - Find `NPM_TOKEN` and click "Update" (or create new if it doesn't exist)
   - Paste your new token
   - Click "Update secret"

3. **Test it**:
   - Go to https://github.com/commoncurriculum/supergrain/actions/workflows/publish.yml
   - Click "Run workflow"
   - Select branch: `main`
   - Click "Run workflow"
   - It should now succeed!

## Need More Help?

See the comprehensive troubleshooting guide:
📖 **[TROUBLESHOOTING_RELEASE.md](TROUBLESHOOTING_RELEASE.md)**

This guide includes:
- Detailed diagnosis steps
- How to verify each part of your setup
- Commands to test your token locally
- Solutions for every possible issue

## Common Mistakes

❌ **Wrong token type**: Must be "Automation", not "Publish"
❌ **Wrong permissions**: Must have "Read and Write"
❌ **No org access**: Token must have access to `@supergrain`
❌ **Expired token**: Check the expiration date

## Still Stuck?

If you've followed these steps and it's still not working:
1. Check the full error logs in the GitHub Actions tab
2. Review [TROUBLESHOOTING_RELEASE.md](TROUBLESHOOTING_RELEASE.md) for detailed steps
3. Try the local testing commands in the troubleshooting guide
