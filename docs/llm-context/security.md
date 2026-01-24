# Security

## Overview

Query Pilot handles sensitive data (database credentials, API keys) with defense in depth.

## Vault Storage

**Purpose**: Encrypted storage for connection profiles

**Implementation**: Tauri vault API (`vault_write`/`vault_read`)

**Frontend service**: `src/services/vaultStorage.ts`

**Features**:
- In-memory cache with dirty-flag tracking
- Debounced writes (250ms) to prevent thrashing
- Encrypted at rest

## Keychain Integration

**Purpose**: OS-native storage for API keys

**Implementation**: `keyring` crate (Rust)

**Platforms**:
- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service

**Key points**:
- API keys stored in native OS keychain
- Never transmitted over IPC in plaintext
- Sidecar loads keys on startup
- Frontend never has direct access to keys

## Credentials Flow

```
┌──────────────────────────────────────────────────────────┐
│                     User Input                            │
└──────────────────┬───────────────────────────────────────┘
                   │
    ┌──────────────┴──────────────┐
    ▼                             ▼
┌─────────────┐           ┌─────────────┐
│   Vault     │           │  Keychain   │
│ (Tauri API) │           │  (keyring)  │
│             │           │             │
│ Connection  │           │  API Keys   │
│ Profiles    │           │  (AI/etc)   │
└─────────────┘           └─────────────┘
    │                             │
    ▼                             ▼
┌─────────────┐           ┌─────────────┐
│   Backend   │           │  AI Sidecar │
│  (Rust)     │           │   (Bun)     │
└─────────────┘           └─────────────┘
```

## Best Practices

1. **Never commit secrets** - `.env` files are gitignored
2. **Use vault for connection credentials** - encrypted at rest
3. **Use keychain for API keys** - OS-native security
4. **Frontend never handles raw credentials** - always via Tauri commands

## Relevant Files

| File | Purpose |
|------|---------|
| `src/services/vaultStorage.ts` | Frontend vault access |
| `src-tauri/src/vault.rs` | Rust vault implementation |
| `src-tauri/src/keychain.rs` | OS keychain integration |
| `.env` | Local env vars (gitignored) |
| `.env.development` | Dev environment defaults |
