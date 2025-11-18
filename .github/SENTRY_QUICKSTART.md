# 🚀 Sentry Quick Start

**5-minute setup for error tracking across Frontend + Backend + AI Sidecar**

---

## 📋 Checklist

- [ ] Create Sentry account at https://sentry.io
- [ ] Create 1 project named "query-pilot"
- [ ] Copy the DSN
- [ ] Create auth token
- [ ] Add 2 GitHub secrets
- [ ] Push a tag to test

---

## 🎯 Setup Steps

### 1. Create Sentry Project
```
→ https://sentry.io
→ Create Project
→ Platform: JavaScript | Framework: React
→ Name: query-pilot
→ Create
```

### 2. Get DSN
```
→ Settings → Client Keys (DSN)
→ Copy: https://xxxxx@sentry.io/123456
```

### 3. Create Auth Token
```
→ Settings → Account → API → Auth Tokens
→ Create New Token
→ Scopes: ✓ project:releases ✓ project:write
→ Copy token
```

### 4. Add GitHub Secrets
```
→ Your Repo → Settings → Secrets → Actions
→ New secret:
   Name: SENTRY_DSN
   Value: [paste DSN]
→ New secret:
   Name: SENTRY_AUTH_TOKEN
   Value: [paste token]
```

### 5. Test
```bash
git tag v1.0.0-test
git push origin v1.0.0-test
```

**Check GitHub Actions logs for:**
```
🔍 Sentry configured - source maps will be uploaded
```

---

## ✅ What You Get

| Component | Errors Go To | Tagged As |
|-----------|--------------|-----------|
| React Frontend | Same project | `platform:javascript` |
| Rust Backend | Same project | `platform:rust` |
| AI Sidecar | Same project | `platform:node` |

**Filter in Sentry:** `component:frontend`, `component:backend`, `component:sidecar`

---

## 🔒 Privacy

**Never Sent:**
- ❌ SQL queries
- ❌ User messages
- ❌ API keys
- ❌ Credentials

**Only Sent:**
- ✅ Error stack traces
- ✅ App version
- ✅ OS info

---

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| Build fails | Check auth token has `project:releases` + `project:write` |
| No errors in Sentry | User must enable in app: Preferences → Telemetry |
| Source maps missing | Add `SENTRY_AUTH_TOKEN` secret |
| Invalid DSN error | Check format: `https://KEY@HOST/PROJECT_ID` |

---

## 📊 Free Tier

- ✅ 5,000 errors/month
- ✅ 10,000 transactions/month
- ✅ 30 days retention
- ✅ Plenty for most projects!

---

## 🔗 Links

- **Full Guide**: `.github/SENTRY_SETUP.md`
- **Sentry Docs**: https://docs.sentry.io
- **Get Help**: https://github.com/[your-repo]/issues

---

**That's it!** 🎉

Next release = Automatic error tracking for all users who opt-in.
