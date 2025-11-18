# Sentry Setup Guide for GitHub Actions

**TL;DR**: Create 1 Sentry project, add 2 GitHub secrets, done! 🎉

## Quick Setup (5 Minutes)

### Step 1: Create Sentry Project
1. Go to https://sentry.io (free account)
2. **Create Project**:
   - Platform: **JavaScript**
   - Framework: **React**
   - Name: **query-pilot**

### Step 2: Get Your DSN
1. In your project: **Settings → Client Keys (DSN)**
2. Copy the DSN (looks like: `https://xxxxx@sentry.io/123456`)

### Step 3: Create Auth Token
1. Go to **Settings → Account → API → Auth Tokens**
2. Click **Create New Token**:
   - Name: `GitHub Actions - Query Pilot`
   - Scopes: Check **`project:releases`** and **`project:write`**
3. Copy the token

### Step 4: Add to GitHub Secrets
1. Go to your repo: **Settings → Secrets and variables → Actions**
2. Click **New repository secret** and add:

```
Name: SENTRY_DSN
Value: [paste your DSN from Step 2]

Name: SENTRY_AUTH_TOKEN
Value: [paste your token from Step 3]
```

### Step 5: Test It!
```bash
# Push a tag to trigger release
git tag v1.0.0-test
git push origin v1.0.0-test

# Check GitHub Actions logs for:
# "🔍 Sentry configured - source maps will be uploaded"
```

**Done!** Next release will have Sentry error tracking. Users can opt-in via Preferences → Telemetry.

---

## What Gets Tracked?

All three components report to the **same Sentry project** with automatic tagging:

| Component | Automatically Tagged As |
|-----------|------------------------|
| **Frontend (React)** | `platform:javascript`, `component:frontend` |
| **Backend (Rust)** | `platform:rust`, `component:backend` |
| **AI Sidecar (Bun)** | `platform:node`, `component:sidecar` |

**In Sentry Dashboard**, filter by:
- `component:frontend` → See frontend errors
- `component:backend` → See backend errors
- `component:sidecar` → See AI sidecar errors

---

## GitHub Secrets Reference

### Required (Minimum 2 Secrets):

| Secret Name | What It Is | Where to Get It |
|-------------|------------|-----------------|
| `SENTRY_DSN` | Your project's error reporting endpoint | Sentry Project → Settings → Client Keys (DSN) |
| `SENTRY_AUTH_TOKEN` | Token for uploading source maps | Sentry Account → Settings → API → Auth Tokens |

### Optional (Have Defaults):

| Secret Name | Default | When to Set |
|-------------|---------|-------------|
| `SENTRY_ORG` | `query-pilot` | If your Sentry org slug is different |
| `SENTRY_PROJECT` | `query-pilot` | If your project name is different |

---

## How It Works

### With Sentry Configured:
```bash
[GitHub Actions Log]
🔍 Sentry configured - source maps will be uploaded
🚀 Building with telemetry feature enabled
✅ Rust backend: cargo build --features telemetry
✅ Frontend: pnpm build (source maps uploaded)
✅ Release created: query-pilot@1.0.0
```

### Without Sentry (Default):
```bash
[GitHub Actions Log]
⚠️  Sentry not configured - telemetry disabled
🚀 Building without telemetry
✅ App builds successfully (no errors)
```

**No secrets?** App builds fine! Sentry features are optional. ✅

---

## Verify It's Working

After your first release with Sentry configured:

### 1. Check GitHub Actions
Look for these messages in the build logs:
- ✅ `🔍 Sentry configured - source maps will be uploaded`
- ✅ `🚀 Building with telemetry feature enabled`
- ✅ No build errors

### 2. Check Sentry Dashboard
- Go to **Releases** tab
- Should see: `query-pilot@[your-version]`
- Click the release → Should show uploaded source maps

### 3. Test Error Reporting
- Download the built app
- Open **Preferences → Telemetry & Reporting**
- Toggle **"Enable crash reporting"** ON
- Restart the app
- Trigger a test error (e.g., try to connect to invalid database)
- Check Sentry dashboard → should see the error appear!

---

## Privacy & Security

### ✅ What Gets Sent to Sentry:
- Error stack traces
- App version, OS, architecture
- Operation type (e.g., "database_query", "connection_failed")
- Error context (anonymized)

### ❌ What NEVER Gets Sent:
- SQL queries or database content
- User messages or AI responses
- API keys or credentials
- Database connection strings
- Personal user information

### How We Protect Privacy:
- **Opt-in only**: Users must enable crash reporting in Preferences
- **Data sanitization**: `beforeSend` hooks strip sensitive data automatically
- **No tracking**: We don't track user behavior, only errors
- **Default disabled**: Telemetry is OFF by default

---

## Troubleshooting

### Issue: Build fails with "Sentry upload failed"
**Cause**: Auth token invalid or missing permissions
**Fix**: Regenerate token with both `project:releases` and `project:write` scopes

### Issue: No errors appearing in Sentry
**Cause**: User hasn't opted in
**Fix**: In the app → Preferences → Telemetry → Enable crash reporting → Restart app

### Issue: Source maps not uploaded
**Cause**: `SENTRY_AUTH_TOKEN` not set
**Fix**: Add `SENTRY_AUTH_TOKEN` secret in GitHub → Trigger new release

### Issue: "Invalid DSN" error
**Cause**: DSN format incorrect
**Fix**: Verify DSN format: `https://[KEY]@[HOST]/[PROJECT_ID]` (no extra spaces/characters)

### Issue: Rate limit errors in Sentry
**Cause**: Too many errors hitting free tier limit (5,000/month)
**Fix**:
- Check what's causing frequent errors
- Consider upgrading Sentry plan
- Or apply for free open-source sponsorship: https://sentry.io/for/open-source/

---

## Cost & Free Tier

**Sentry Free Tier Includes:**
- ✅ 5,000 errors per month
- ✅ 10,000 performance transactions per month
- ✅ 50 session replays per month
- ✅ 1 GB file storage
- ✅ 30 days data retention

**For Open Source Projects:**
- Apply for free Sentry sponsorship: https://sentry.io/for/open-source/
- Includes higher limits for qualifying open-source projects

**Typical Usage for Query Pilot:**
- ~100-500 errors/month for most users
- Well within free tier limits ✅

---

## Removing Sentry

To build without Sentry:
1. Delete `SENTRY_DSN` and `SENTRY_AUTH_TOKEN` from GitHub secrets
2. Next build will automatically skip Sentry integration
3. App builds and runs perfectly fine without telemetry

---

## Need Help?

- **Sentry Documentation**: https://docs.sentry.io
- **Sentry Support**: support@sentry.io (for account/billing issues)
- **Query Pilot Issues**: https://github.com/[your-repo]/issues

---

**Summary**: Create 1 project, add 2 secrets, ship it! 🚀
