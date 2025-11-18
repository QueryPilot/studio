# Sentry Documentation Index

Complete guide to finding Sentry-related documentation in Query Pilot.

---

## For Users

### How to Enable/Disable Error Tracking

**Location in App:**
```
Preferences → Telemetry & Error Reporting
```

**What You Can Control:**
- ✅ Enable error tracking (master switch)
- ✅ Performance monitoring (10% sample rate)
- ✅ Session replay on errors (50% sample rate)

**Privacy:**
- Disabled by default
- Opt-in only
- Clear disclosure of what's collected
- Instant disable (no restart required)

---

## For Developers

### Quick Reference

| Document | Purpose | Audience |
|----------|---------|----------|
| **[SENTRY.md](../SENTRY.md)** | **Comprehensive technical documentation** | All developers |
| [SENTRY_QUICKSTART.md](./SENTRY_QUICKSTART.md) | 5-minute production setup | DevOps, Release managers |
| [SENTRY_SETUP.md](./SENTRY_SETUP.md) | Detailed production setup | DevOps, Release managers |
| [CLAUDE.md](../CLAUDE.md#telemetry--error-reporting) | Project overview with Sentry section | All developers, AI assistants |
| [README.md](../README.md#telemetry--privacy) | User-facing privacy info | End users, Contributors |

---

## Documentation Hierarchy

### 1. **SENTRY.md** (Comprehensive Technical Documentation)

**Location:** `/SENTRY.md`

**Contents:**
- Complete architecture overview
- User controls and experience
- What gets tracked (detailed)
- Privacy & security safeguards
- Setup for local development
- Setup for production
- Technical implementation details
- Testing procedures
- Troubleshooting guide

**Use this when:**
- You need to understand the complete integration
- Implementing new features that interact with Sentry
- Debugging Sentry-related issues
- Onboarding new developers

---

### 2. **SENTRY_QUICKSTART.md** (5-Minute Production Setup)

**Location:** `/.github/SENTRY_QUICKSTART.md`

**Contents:**
- Checklist format
- Minimal steps to get Sentry working
- GitHub secrets configuration
- Quick verification steps

**Use this when:**
- Setting up Sentry for the first time
- You just need to get it working quickly
- Sharing setup steps with team members

---

### 3. **SENTRY_SETUP.md** (Detailed Production Setup)

**Location:** `/.github/SENTRY_SETUP.md`

**Contents:**
- Detailed step-by-step setup
- Single project approach (recommended)
- Advanced multi-project setup
- GitHub Actions integration
- Troubleshooting common issues
- Cost and free tier information

**Use this when:**
- You need more details than the quickstart
- Setting up advanced configurations
- Troubleshooting setup issues
- Understanding GitHub Actions integration

---

### 4. **CLAUDE.md** (Project Documentation)

**Location:** `/CLAUDE.md`

**Sentry Section:** Lines 163-255

**Contents:**
- Overview of Sentry integration in project context
- Quick reference for each component
- Build configuration examples
- Links to detailed documentation

**Use this when:**
- Understanding the project architecture
- Quick reference for build commands
- Seeing how Sentry fits into the overall project

---

### 5. **README.md** (User-Facing)

**Location:** `/README.md`

**Sentry Section:** "Telemetry & Privacy"

**Contents:**
- User-facing privacy information
- How users control data collection
- Links to detailed documentation

**Use this when:**
- Communicating privacy to end users
- Contributing guidelines mention telemetry
- Public-facing documentation

---

## Component-Specific Documentation

### Frontend (React)

**Code Files:**
- `src/utils/sentry.ts` - Utilities and initialization
- `src/main.tsx` - Sentry.init() call
- `src/components/ErrorBoundary.tsx` - Error capture
- `src/components/Preferences/panels/TelemetryPanel.tsx` - UI controls
- `vite.config.ts` - Source map upload

**Key Functions:**
```typescript
// src/utils/sentry.ts
initializeSentry()     // Initialize with user preferences
disableSentry()        // Runtime disable (immediate)
captureException()     // Error capture with context
addBreadcrumb()        // Debugging breadcrumbs
```

### Backend (Rust)

**Code Files:**
- `src-tauri/src/sentry_integration.rs` - Integration module
- `src-tauri/src/main.rs` - Initialization
- `src-tauri/Cargo.toml` - Feature flag configuration

**Feature Flag:**
```bash
cargo build --features telemetry
```

### AI Sidecar (Bun)

**Code Files:**
- `src-tauri/sidecar-ai/utils/sentry.ts` - Utilities
- `src-tauri/sidecar-ai/routes/config.ts` - Config endpoint
- `src-tauri/sidecar-ai/index.ts` - Global error handlers

---

## Common Tasks

### I want to...

**...set up Sentry for production:**
→ Read [SENTRY_QUICKSTART.md](./SENTRY_QUICKSTART.md) first
→ Then [SENTRY_SETUP.md](./SENTRY_SETUP.md) for details

**...understand how Sentry works in Query Pilot:**
→ Read [SENTRY.md](../SENTRY.md) - Architecture section

**...implement a new feature that uses Sentry:**
→ Read [SENTRY.md](../SENTRY.md) - Technical Implementation section

**...debug why Sentry isn't working:**
→ Read [SENTRY.md](../SENTRY.md) - Troubleshooting section
→ Check [SENTRY_SETUP.md](./SENTRY_SETUP.md) - Troubleshooting

**...understand privacy safeguards:**
→ Read [SENTRY.md](../SENTRY.md) - Privacy & Security section
→ Read [README.md](../README.md) - Telemetry & Privacy

**...add Sentry error capture to new code:**
→ Frontend: Use `captureException()` from `src/utils/sentry.ts`
→ Backend: Use `capture_error()` from `sentry_integration.rs`
→ Sidecar: Use `captureException()` from `utils/sentry.ts`

**...test Sentry locally:**
→ Read [SENTRY.md](../SENTRY.md) - Setup for Developers section

**...configure GitHub Actions:**
→ Read [SENTRY_SETUP.md](./SENTRY_SETUP.md) - GitHub Actions Setup

---

## Quick Links

### User Documentation
- [Privacy Information](../README.md#telemetry--privacy)
- [How to Enable/Disable](../SENTRY.md#user-controls)

### Developer Documentation
- [Complete Technical Docs](../SENTRY.md)
- [Architecture](../SENTRY.md#architecture)
- [Implementation Details](../SENTRY.md#technical-implementation)
- [Testing](../SENTRY.md#testing)

### Setup Guides
- [Quick Setup (5 min)](./SENTRY_QUICKSTART.md)
- [Detailed Setup](./SENTRY_SETUP.md)
- [GitHub Actions](./SENTRY_SETUP.md#github-actions-setup)

### Reference
- [Environment Variables](../SENTRY.md#setup-for-production)
- [Build Configuration](../CLAUDE.md#telemetry--error-reporting)
- [Troubleshooting](../SENTRY.md#troubleshooting)

---

## File Locations Summary

```
query-pilot/
├── SENTRY.md                              ← Comprehensive technical documentation
├── README.md                              ← User-facing privacy info
├── CLAUDE.md                              ← Project documentation with Sentry section
├── .github/
│   ├── SENTRY_QUICKSTART.md              ← 5-minute production setup
│   ├── SENTRY_SETUP.md                   ← Detailed production setup
│   ├── SENTRY_DOCS_INDEX.md              ← This file
│   └── workflows/
│       └── release.yml                    ← GitHub Actions with Sentry integration
├── src/
│   ├── utils/
│   │   └── sentry.ts                      ← Frontend utilities
│   ├── main.tsx                           ← Frontend initialization
│   ├── components/
│   │   ├── ErrorBoundary.tsx             ← Error capture
│   │   └── Preferences/panels/
│   │       └── TelemetryPanel.tsx        ← User controls UI
├── src-tauri/
│   ├── src/
│   │   ├── sentry_integration.rs         ← Backend integration
│   │   └── main.rs                        ← Backend initialization
│   ├── Cargo.toml                         ← Feature flag config
│   └── sidecar-ai/
│       ├── utils/
│       │   └── sentry.ts                  ← Sidecar utilities
│       ├── routes/
│       │   └── config.ts                  ← Sidecar config endpoint
│       └── index.ts                       ← Sidecar error handlers
└── .env.production                        ← Environment variables template
```

---

**Last Updated:** 2025-01-19
**Maintained By:** Development Team
