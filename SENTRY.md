# Sentry Integration Documentation

Complete guide to error tracking and performance monitoring in Query Pilot.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [User Controls](#user-controls)
4. [What Gets Tracked](#what-gets-tracked)
5. [Privacy & Security](#privacy--security)
6. [Setup for Developers](#setup-for-developers)
7. [Setup for Production](#setup-for-production)
8. [Technical Implementation](#technical-implementation)
9. [Testing](#testing)
10. [Troubleshooting](#troubleshooting)

---

## Overview

Query Pilot integrates Sentry for crash reporting and performance monitoring across all three components:
- **Frontend (React)**: JavaScript errors, React component errors, page load times
- **Backend (Rust)**: Panics, errors, database operation timing
- **AI Sidecar (Bun)**: Uncaught exceptions, LLM request timing

**Key Principles:**
- ✅ **Opt-in only**: Disabled by default, user must explicitly enable
- ✅ **Privacy-first**: No SQL queries, credentials, or user data sent
- ✅ **Runtime control**: Users can disable instantly, enable requires restart
- ✅ **Single project**: All components report to one Sentry project with automatic tagging

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        User                                  │
│  Preferences → Telemetry & Error Reporting                  │
│  ├─ Enable error tracking          [OFF by default]         │
│  ├─ Performance monitoring          [OFF by default]         │
│  └─ Session replay on errors        [OFF by default]         │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
         ┌──────────▼──────────┐   ┌───▼────────────┐
         │  Frontend (React)   │   │  Backend (Rust) │
         │  @sentry/react      │   │  sentry crate   │
         │  • Errors           │   │  • Panics       │
         │  • Performance      │   │  • Errors       │
         │  • Session Replay   │   │  • Tracing      │
         └─────────┬───────────┘   └────┬───────────┘
                   │                    │
                   │    ┌───────────────▼─────────┐
                   │    │  AI Sidecar (Bun)       │
                   │    │  @sentry/node           │
                   │    │  • Exceptions           │
                   │    │  • HTTP timing          │
                   │    └─────────┬───────────────┘
                   │              │
                   └──────┬───────┘
                          │
                   ┌──────▼───────────────────────┐
                   │   Sentry Project             │
                   │   (Single unified project)   │
                   │                              │
                   │   Automatic Tagging:         │
                   │   • component: frontend      │
                   │   • component: backend       │
                   │   • component: sidecar       │
                   │   • platform: javascript     │
                   │   • platform: rust           │
                   │   • platform: node           │
                   └──────────────────────────────┘
```

### Data Flow

**Error Tracking:**
```
Error occurs → beforeSend hook (sanitization) → Sentry API → Dashboard
```

**Performance Monitoring:**
```
Operation start → Create span → Operation end → Sample (10%) → Sentry API
```

**User Control:**
```
Toggle OFF → disableSentry() → Sentry.close() → No more data sent ✅
Toggle ON  → Show restart alert → User restarts → Sentry.init() → Tracking enabled ✅
```

---

## User Controls

### Location
**Main Screen & Workspace Screen:**
`Preferences → Telemetry & Error Reporting`

### Available Options

#### 1. Enable Error Tracking
- **Default**: OFF (disabled)
- **Controls**: All Sentry functionality
- **Disable**: Takes effect immediately (calls `disableSentry()`)
- **Enable**: Requires app restart (needs DSN and full initialization)
- **Status Indicator**: Shows active (green) or disabled (yellow)

#### 2. Performance Monitoring
- **Default**: OFF (disabled)
- **Requires**: Error tracking to be enabled
- **Sample Rate**: 10% of operations
- **Tracks**: Page loads, API calls, database queries, component renders
- **Impact**: Minimal performance overhead

#### 3. Session Replay on Errors
- **Default**: OFF (disabled)
- **Requires**: Error tracking to be enabled
- **Sample Rate**: 50% of errors
- **Privacy**: All text masked, all media blocked
- **Purpose**: Visual context for debugging errors

### User Experience

**Disabling Error Tracking:**
```
User toggles OFF → Toast: "Error tracking disabled"
→ Sentry.close() → Immediate effect ✅
```

**Enabling Error Tracking:**
```
User toggles ON → Yellow alert: "Restart required"
→ Toast: "Please restart Query Pilot"
→ User restarts app → Sentry.init() → Active ✅
```

---

## What Gets Tracked

### Frontend (React)

**Error Tracking:**
- JavaScript runtime errors
- React component errors (via ErrorBoundary)
- Promise rejections
- API call failures
- Network errors

**Performance Monitoring:**
- Page load time (initial render)
- Route navigation timing
- Component render duration
- API request/response time
- Browser resource loading (scripts, CSS, images)
- User interaction timing (click to response)

**Session Replay (if enabled):**
- DOM mutations (text masked)
- Mouse movements and clicks
- Scroll events
- Network requests (sanitized)

**Captured Context:**
```javascript
{
  release: "query-pilot@0.4.0",
  environment: "production",
  platform: "javascript",
  tags: {
    component: "frontend",
    operation: "query_execution" // example
  },
  user: {
    id: "anonymous-uuid" // No identifying info
  }
}
```

### Backend (Rust)

**Error Tracking:**
- Panic handlers (via `sentry::integrations::panic`)
- Manual error captures
- Database connection failures
- SSH tunnel errors
- CRUD operation failures

**Performance Monitoring:**
```rust
// Automatic transaction tracking
let transaction = sentry::start_transaction(...);
// ... database query ...
transaction.finish();
```

**Tracked Operations:**
- Database queries (timing only, no SQL)
- Connection pool operations
- SSH tunnel establishment
- CRUD transactions
- Vault operations

**Captured Context:**
```rust
sentry::configure_scope(|scope| {
    scope.set_tag("component", "backend");
    scope.set_tag("adapter", "postgresql"); // example
    scope.set_extra("connection_id", "redacted");
});
```

### AI Sidecar (Bun)

**Error Tracking:**
- Uncaught exceptions (`process.on('uncaughtException')`)
- Unhandled promise rejections
- HTTP route errors
- LLM API failures

**Performance Monitoring:**
- HTTP endpoint latency
- LLM request/response time
- Provider API call duration

**Captured Context:**
```typescript
{
  release: "query-pilot-sidecar@0.4.0",
  environment: "production",
  platform: "node",
  tags: {
    component: "sidecar",
    provider: "openai" // example, if applicable
  }
}
```

---

## Privacy & Security

### Data We NEVER Send

❌ **SQL Queries**
```typescript
// beforeSend hook strips these
if (breadcrumb.message?.includes("SQL")) {
  breadcrumb.message = "[SQL query - redacted for privacy]";
}
```

❌ **Database Credentials**
```rust
// Sanitization in Rust
if key.contains("password") || key.contains("secret") {
    return "[REDACTED]".to_string();
}
```

❌ **API Keys**
- Frontend: Never exposed to frontend code
- Backend: Sanitized in `beforeSend` hooks
- Sidecar: Configured via config endpoint, never logged

❌ **User Messages / AI Responses**
```typescript
// Sidecar explicitly filters
if (error.context?.includes('message') || error.context?.includes('response')) {
    delete error.context;
}
```

❌ **Personal Information**
- No email addresses
- No usernames
- No connection strings
- Anonymous user IDs only

❌ **Database Content**
- No query results
- No table data
- No schema details in errors

### Data We DO Send

✅ **Error Context**
- Stack traces (source mapped)
- Error messages (sanitized)
- Operation type (e.g., "database_query", "ssh_connect")
- Component name

✅ **System Information**
- OS and version
- App version
- Architecture (x64, arm64)
- Browser (frontend only)

✅ **Performance Metrics**
- Operation duration (ms)
- Transaction timing
- Span timing (no data)

✅ **Anonymized User ID**
- Generated UUID
- No identifying information

### Sanitization Pipeline

**Frontend (`src/utils/sentry.ts`):**
```typescript
beforeSend(event) {
  // Remove request bodies
  if (event.request?.data) delete event.request.data;

  // Remove cookies
  if (event.request?.cookies) delete event.request.cookies;

  // Sanitize breadcrumbs
  event.breadcrumbs = event.breadcrumbs.map(breadcrumb => {
    if (breadcrumb.message?.includes("SQL")) {
      return { ...breadcrumb, message: "[SQL query - redacted]" };
    }
    return breadcrumb;
  });

  return event;
}
```

**Backend (`src-tauri/src/sentry_integration.rs`):**
```rust
fn sanitize_value(value: &str) -> String {
    let sensitive_patterns = [
        "password", "secret", "token", "key",
        "credential", "auth", "api_key"
    ];

    if sensitive_patterns.iter().any(|p| value.contains(p)) {
        "[REDACTED]".to_string()
    } else {
        value.to_string()
    }
}
```

**Sidecar (`src-tauri/sidecar-ai/utils/sentry.ts`):**
```typescript
beforeSend(event) {
  // Never send user messages or AI responses
  if (event.extra?.userMessage) delete event.extra.userMessage;
  if (event.extra?.aiResponse) delete event.extra.aiResponse;

  // Sanitize API keys
  if (event.extra?.apiKey) event.extra.apiKey = "[REDACTED]";

  return event;
}
```

---

## Setup for Developers

### Local Development

**1. Copy example env file:**
```bash
cp .env.local.example .env.local
```

**2. Add test Sentry DSN (optional):**
```bash
# .env.local
SENTRY_DSN=https://your-test-dsn@o123456.ingest.sentry.io/7654321
SENTRY_AUTH_TOKEN=your-token-for-sourcemaps
```

**3. Enable in app:**
- Run app: `pnpm tauri:dev`
- Open Preferences → Telemetry & Error Reporting
- Toggle "Enable error tracking" ON
- Restart app

**4. Test error tracking:**
```typescript
// Trigger test error in console
throw new Error("Test error for Sentry");
```

### Development Notes

- Sentry is **disabled by default** in development mode
- Even with DSN set, you must enable it in Preferences
- Use a separate Sentry project for development testing
- Source maps are only uploaded in production builds

---

## Setup for Production

### Quick Setup (5 minutes)

See `.github/SENTRY_QUICKSTART.md` for step-by-step guide.

### Detailed Setup

**1. Create Sentry Project**
```
→ https://sentry.io
→ Create Project
→ Platform: JavaScript
→ Framework: React
→ Name: query-pilot
```

**2. Get DSN**
```
→ Settings → Client Keys (DSN)
→ Copy: https://xxxxx@o123456.ingest.sentry.io/7654321
```

**3. Create Auth Token**
```
→ Settings → Account → API → Auth Tokens
→ Create New Token
→ Scopes: ✓ project:releases ✓ project:write
→ Copy token
```

**4. Add GitHub Secrets**
```
→ Repository → Settings → Secrets → Actions
→ New secret:
   Name: SENTRY_DSN
   Value: [paste DSN]
→ New secret:
   Name: SENTRY_AUTH_TOKEN
   Value: [paste token]
```

**5. Push a tag to trigger release:**
```bash
git tag v1.0.0
git push origin v1.0.0
```

**6. Verify in GitHub Actions logs:**
```
🔍 Sentry configured - source maps will be uploaded
🚀 Building with telemetry feature enabled
✅ Rust backend: cargo build --features telemetry
✅ Frontend: pnpm build (source maps uploaded)
✅ Release created: query-pilot@1.0.0
```

### Environment Variables

**GitHub Secrets (Required):**
- `SENTRY_DSN` - DSN for all components
- `SENTRY_AUTH_TOKEN` - For source map uploads

**GitHub Secrets (Optional):**
- `SENTRY_ORG` - Organization slug (default: query-pilot)
- `SENTRY_PROJECT` - Project name (default: query-pilot)

---

## Technical Implementation

### Frontend (React)

**Files:**
- `src/utils/sentry.ts` - Initialization and utilities
- `src/main.tsx` - Sentry.init() call
- `src/components/ErrorBoundary.tsx` - React error capture
- `vite.config.ts` - Source map upload configuration

**Initialization:**
```typescript
// src/main.tsx
import { initializeSentry } from "./utils/sentry";
import { usePreferencesStore } from "./stores/preferencesStore";

const telemetryPrefs = usePreferencesStore.getState().telemetry;
initializeSentry(telemetryPrefs, "0.4.0");
```

**Error Boundary Integration:**
```typescript
// src/components/ErrorBoundary.tsx
componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  captureException(error, {
    operation: "react-error-boundary",
    componentStack: errorInfo.componentStack,
  });
}
```

**Source Map Upload:**
```typescript
// vite.config.ts
import { sentryVitePlugin } from "@sentry/vite-plugin";

export default defineConfig({
  plugins: [
    sentryVitePlugin({
      org: process.env.SENTRY_ORG || "query-pilot",
      project: process.env.SENTRY_PROJECT || "query-pilot",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        assets: ["./dist/**"],
      },
    }),
  ],
});
```

**Performance Monitoring:**
```typescript
Sentry.init({
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
  tracesSampleRate: telemetryPrefs.performanceMonitoring ? 0.1 : 0,
});
```

### Backend (Rust)

**Files:**
- `src-tauri/src/sentry_integration.rs` - Initialization and utilities
- `src-tauri/src/main.rs` - Sentry guard creation
- `src-tauri/Cargo.toml` - Feature flag configuration

**Cargo.toml:**
```toml
[dependencies]
sentry = { version = "0.34", optional = true, features = [
    "backtrace",
    "contexts",
    "panic",
    "rustls"
] }
sentry-tracing = { version = "0.34", optional = true }

[features]
telemetry = ["sentry", "sentry-tracing"]
```

**Initialization:**
```rust
// src-tauri/src/main.rs
#[cfg(feature = "telemetry")]
let _sentry_guard = sentry_integration::initialize_sentry(
    sentry_enabled,
    env!("CARGO_PKG_VERSION")
);
```

**Error Capture:**
```rust
// src-tauri/src/sentry_integration.rs
pub fn capture_error(error: &str, context: HashMap<String, String>) {
    sentry::capture_message(error, sentry::Level::Error);
}
```

**Performance Tracking:**
```rust
let transaction = sentry::start_transaction(
    sentry::TransactionContext::new("database_query", "query")
);
// ... perform database query ...
transaction.finish();
```

**Build with Feature:**
```bash
# Development (no telemetry)
cargo build

# Production (with telemetry)
cargo build --release --features telemetry
```

### AI Sidecar (Bun)

**Files:**
- `src-tauri/sidecar-ai/utils/sentry.ts` - Initialization
- `src-tauri/sidecar-ai/routes/config.ts` - Config endpoint
- `src-tauri/sidecar-ai/index.ts` - Global error handlers

**Configuration Flow:**
```typescript
// Backend sends config to sidecar
POST http://localhost:47856/config
{
  sentryEnabled: true,
  sentryDsn: "https://...",
  openai: "sk-...",
  // ... other API keys
}

// Sidecar initializes Sentry
initializeSentry(body.sentryEnabled, body.sentryDsn, SIDECAR_VERSION);
```

**Global Error Handlers:**
```typescript
// src-tauri/sidecar-ai/index.ts
process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught exception:", error);
  sentryCaptureException(error, { operation: "uncaughtException" });
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("💥 Unhandled rejection:", reason);
  if (reason instanceof Error) {
    sentryCaptureException(reason, { operation: "unhandledRejection" });
  }
});
```

**Error Capture:**
```typescript
// src-tauri/sidecar-ai/utils/sentry.ts
export function captureException(
  error: Error,
  context?: Record<string, unknown>
): void {
  if (!Sentry.isInitialized()) return;

  Sentry.captureException(error, {
    tags: { component: "sidecar" },
    extra: context,
  });
}
```

### User Preferences

**Store:**
```typescript
// src/stores/preferencesStore.ts
interface TelemetryPreferences {
  sentryEnabled: boolean;           // Default: false
  performanceMonitoring: boolean;   // Default: false
  sessionReplay: boolean;           // Default: false
}

const usePreferencesStore = create(
  persist(
    (set) => ({
      telemetry: {
        sentryEnabled: false,
        performanceMonitoring: false,
        sessionReplay: false,
      },
      // ...
    }),
    { name: "preferences" }
  )
);
```

**UI Component:**
```typescript
// src/components/Preferences/panels/TelemetryPanel.tsx
const handleCrashReportingToggle = async (checked: boolean) => {
  setTelemetry({ sentryEnabled: checked });

  if (!checked) {
    // Disable immediately
    disableSentry();
    toast.success("Error tracking disabled");
  } else {
    // Requires restart
    setNeedsRestart(true);
    toast.info("Restart required");
  }
};
```

**Runtime Disable:**
```typescript
// src/utils/sentry.ts
export function disableSentry(): void {
  if (!Sentry.isInitialized()) return;

  const client = Sentry.getClient();
  if (client) {
    client.close(2000); // Wait 2s for events to flush
  }
}
```

---

## Testing

### Manual Testing

**1. Test Error Capture (Frontend):**
```javascript
// Open browser console
throw new Error("Test error from frontend");
```

**2. Test Error Capture (Backend):**
```rust
// Add to any Tauri command
panic!("Test panic from backend");
```

**3. Test Performance Monitoring:**
```typescript
// Enable performance monitoring in Preferences
// Navigate between pages
// Check Sentry dashboard for transactions
```

**4. Test Runtime Disable:**
1. Enable error tracking → Restart
2. Open Preferences → Disable error tracking
3. Check console: `[Sentry] Disabled successfully`
4. Trigger error → Should NOT appear in Sentry

### Automated Testing

**Frontend:**
```bash
pnpm test:unit
```

**Backend:**
```bash
cd src-tauri && cargo test --features telemetry
```

### Verification Checklist

- [ ] Fresh install → Sentry is disabled by default
- [ ] Enable in Preferences → Shows restart alert
- [ ] After restart → Errors appear in Sentry dashboard
- [ ] Disable in Preferences → Toast shows "disabled immediately"
- [ ] After disable → New errors do NOT appear in Sentry
- [ ] Source maps uploaded → Stack traces show real file names
- [ ] Performance monitoring → Transactions appear in dashboard
- [ ] Privacy → No SQL queries in Sentry events
- [ ] Privacy → No credentials in Sentry events

---

## Troubleshooting

### Issue: Build fails with "Sentry upload failed"

**Cause:** Auth token invalid or missing permissions

**Fix:**
```bash
# Regenerate token with correct scopes
→ Sentry → Settings → Account → API → Auth Tokens
→ Create New Token
→ Scopes: ✓ project:releases ✓ project:write
→ Update GitHub secret SENTRY_AUTH_TOKEN
```

### Issue: No errors appearing in Sentry

**Cause:** User hasn't opted in

**Fix:**
1. Open app → Preferences → Telemetry & Error Reporting
2. Toggle "Enable error tracking" ON
3. Restart the app
4. Trigger a test error

### Issue: Source maps not uploaded

**Cause:** `SENTRY_AUTH_TOKEN` not set or invalid

**Fix:**
```bash
# Check GitHub Actions logs
→ Actions → Latest release build
→ Look for "🔍 Sentry configured - source maps will be uploaded"
→ If missing, check SENTRY_AUTH_TOKEN secret
```

### Issue: "Invalid DSN" error

**Cause:** DSN format incorrect

**Fix:**
```bash
# Verify DSN format
https://[PUBLIC_KEY]@[SENTRY_HOST]/[PROJECT_ID]

# Example
https://abc123def456@o123456.ingest.sentry.io/7654321

# Check for:
- No extra spaces
- No quotes
- Correct protocol (https://)
- Valid project ID (numeric)
```

### Issue: Rate limit errors in Sentry

**Cause:** Too many errors hitting free tier limit (5,000/month)

**Fix:**
1. Investigate what's causing frequent errors
2. Fix the underlying issue
3. Consider upgrading Sentry plan
4. Or apply for free open-source sponsorship: https://sentry.io/for/open-source/

### Issue: Performance data not appearing

**Cause:** Performance monitoring not enabled or sample rate too low

**Fix:**
1. Open Preferences → Telemetry & Error Reporting
2. Ensure "Enable error tracking" is ON
3. Toggle "Performance monitoring" ON
4. Restart app
5. Generate transactions (navigate, query databases)
6. Check Sentry Performance dashboard (may take a few minutes)

### Issue: Sentry not disabling immediately

**Cause:** `disableSentry()` not called or client not closing

**Fix:**
```typescript
// Check browser console for
[Sentry] Disabled successfully

// If not appearing, check:
1. TelemetryPanel.tsx - handleCrashReportingToggle calls disableSentry()
2. sentry.ts - disableSentry() properly closes client
3. Browser devtools → Network tab → No more Sentry requests
```

### Issue: Build fails with telemetry feature

**Cause:** Sentry dependency version mismatch

**Fix:**
```bash
cd src-tauri
cargo update sentry
cargo build --features telemetry
```

---

## Cost & Free Tier

**Sentry Free Tier:**
- ✅ 5,000 errors per month
- ✅ 10,000 performance transactions per month
- ✅ 50 session replays per month
- ✅ 1 GB file storage
- ✅ 30 days data retention

**Typical Usage for Query Pilot:**
- ~100-500 errors/month (most users)
- ~1,000-5,000 transactions/month (with 10% sampling)
- Well within free tier limits ✅

**For Open Source Projects:**
Apply for free Sentry sponsorship: https://sentry.io/for/open-source/

---

## Additional Resources

- **Sentry Documentation**: https://docs.sentry.io
- **React Integration**: https://docs.sentry.io/platforms/javascript/guides/react/
- **Rust Integration**: https://docs.sentry.io/platforms/rust/
- **Node.js Integration**: https://docs.sentry.io/platforms/node/
- **Performance Monitoring**: https://docs.sentry.io/product/performance/
- **Privacy Controls**: https://docs.sentry.io/platforms/javascript/data-management/

---

## Summary

**For Users:**
- Error tracking is **opt-in only** (disabled by default)
- Full control via Preferences → Telemetry & Error Reporting
- Disable takes effect immediately, enable requires restart
- Complete privacy - no queries, credentials, or user data sent

**For Developers:**
- Single Sentry project for all components
- Automatic component tagging for filtering
- Feature flag controlled (Rust `telemetry` feature)
- Source map upload via GitHub Actions
- Comprehensive sanitization pipeline

**For Production:**
- 2 GitHub secrets: `SENTRY_DSN` + `SENTRY_AUTH_TOKEN`
- Automatic builds with telemetry enabled
- Release tracking with version tags
- Free tier sufficient for most projects

---

**Last Updated:** 2025-01-19
**Version:** 0.4.0
