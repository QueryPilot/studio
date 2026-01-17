# OAuth Provider Integration (Experimental)

**Status:** Framework implemented, providers disabled by default
**Date:** 2026-01-17
**Stability:** Experimental - depends on community-maintained packages

## Overview

Query Pilot's AI sidecar supports OAuth-based AI providers as an alternative to API key authentication. OAuth providers are categorized as **Tier 2 (Enhanced)** in the provider strategy, offering potential benefits but with added complexity.

## Current State

### ✅ Implemented
- Type system extensions for OAuth providers (`AuthType`, `oauthConfig`)
- OAuth provider configuration structure (`oauth-providers.ts`)
- Tiered provider registry (API Key → OAuth → Ollama)
- Provider filtering based on OAuth enablement
- Documentation and integration guides

### ⏸️ Not Implemented (Stubbed for Future)
- OAuth token management (requires Tauri vault integration)
- Token refresh logic
- OAuth redirect flow for desktop app
- Community package integration (`ai-sdk-provider-claude-code`, `ai-sdk-provider-opencode-sdk`)

## Supported OAuth Providers

| Provider | Package | Status | Notes |
|----------|---------|--------|-------|
| Claude Code | `ai-sdk-provider-claude-code` | Experimental | Community package, uses Claude Agent SDK |
| OpenCode | `ai-sdk-provider-opencode-sdk` | Experimental | Requires OpenCode CLI configured |
| ChatGPT OAuth | `ai-sdk-provider-chatgpt-oauth` | Not Found | May not exist or under different name |

## Why API Key First (Not OAuth-First)?

The implementation prioritizes API key providers over OAuth for the following reasons:

1. **Production Proven**: Current API key providers (OpenAI, Anthropic, Google, xAI) are battle-tested
2. **Complexity**: OAuth adds token refresh, redirect flows, and secure storage requirements
3. **Desktop App Challenge**: OAuth redirect flows are complex for desktop applications
4. **Community Packages**: OAuth providers rely on community-maintained packages with uncertain stability
5. **Marginal UX Benefit**: For a desktop app, API keys offer similar UX with less complexity

## Enabling OAuth Providers

### Step 1: Install OAuth Provider Package

```bash
cd src-tauri/sidecar-ai
npm install ai-sdk-provider-claude-code
# or
npm install ai-sdk-provider-opencode-sdk
```

### Step 2: Enable in Configuration

Edit `config/oauth-providers.ts`:

```typescript
{
  name: "claude-code",
  models: [/* ... */],
  requiresApiKey: false,
  authType: "oauth",
  oauthConfig: {
    enabled: true,  // Change from false to true
    status: "experimental",
    note: "Requires ai-sdk-provider-claude-code package and OAuth token management",
  },
}
```

### Step 3: Implement Token Management (Required)

Create OAuth token manager in Tauri backend:

```rust
// src-tauri/src/oauth/token_manager.rs

use keyring::Entry;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct OAuthToken {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: i64,
    pub provider: String,
}

pub struct OAuthTokenManager;

impl OAuthTokenManager {
    pub fn new() -> Self {
        Self
    }

    pub async fn get_token(&self, provider: &str) -> Result<OAuthToken, String> {
        let entry = Entry::new("querypilot-oauth", provider)
            .map_err(|e| e.to_string())?;
        let token_json = entry.get_password().map_err(|e| e.to_string())?;
        serde_json::from_str(&token_json).map_err(|e| e.to_string())
    }

    pub async fn save_token(&self, token: OAuthToken) -> Result<(), String> {
        let entry = Entry::new("querypilot-oauth", &token.provider)
            .map_err(|e| e.to_string())?;
        let token_json = serde_json::to_string(&token).map_err(|e| e.to_string())?;
        entry.set_password(&token_json).map_err(|e| e.to_string())
    }

    pub async fn refresh_token(&self, provider: &str) -> Result<OAuthToken, String> {
        // Implement OAuth refresh flow
        // This depends on the specific OAuth provider
        unimplemented!("OAuth token refresh not implemented")
    }
}
```

### Step 4: Update Sidecar to Accept OAuth Tokens

Modify `routes/chat.ts`:

```typescript
import type { ChatRequest } from "../types";

// Extend ChatRequest type
interface ChatRequestWithOAuth extends ChatRequest {
  oauthToken?: string; // Short-lived access token from Tauri
}

export async function handleChat(request: Request): Promise<Response> {
  const body: ChatRequestWithOAuth = await request.json();
  const { messages, provider, model, oauthToken } = body;

  // If OAuth token provided, use OAuth provider
  if (oauthToken && provider === "claude-code") {
    const { createClaudeCode } = await import("ai-sdk-provider-claude-code");
    const claudeCode = createClaudeCode({ token: oauthToken });
    // Use claudeCode for inference...
  }

  // Otherwise, fall back to API key providers
  // ...
}
```

### Step 5: Implement OAuth Redirect Flow (Desktop Challenge)

Desktop OAuth requires local server or deep linking:

**Option A: Local HTTP Server**
```typescript
// Start temporary local server on http://localhost:PORT
// Redirect user to OAuth provider with redirect_uri=http://localhost:PORT/callback
// Capture authorization code from callback
// Exchange code for tokens
```

**Option B: Deep Linking**
```typescript
// Register custom URL scheme: querypilot://oauth/callback
// Redirect user to OAuth provider with redirect_uri=querypilot://oauth/callback
// Handle deep link in Tauri to capture authorization code
```

## Architecture

### Token Flow

```
┌─────────────┐                    ┌─────────────┐                    ┌─────────────┐
│  Frontend   │                    │    Tauri    │                    │   Sidecar   │
│   (React)   │                    │   (Rust)    │                    │   (Bun)     │
└─────────────┘                    └─────────────┘                    └─────────────┘
       │                                  │                                  │
       │ 1. Request chat                  │                                  │
       ├─────────────────────────────────>│                                  │
       │                                  │                                  │
       │                                  │ 2. Check OAuth token             │
       │                                  │ (from OS keychain)               │
       │                                  │                                  │
       │                                  │ 3. Pass ephemeral token          │
       │                                  ├─────────────────────────────────>│
       │                                  │                                  │
       │                                  │                                  │ 4. Use token
       │                                  │                                  │ (NOT persisted)
       │                                  │                                  │
       │                                  │         5. Response              │
       │<──────────────────────────────────────────────────────────────────────┤
```

### Security Principles

1. **Sidecar NEVER persists refresh tokens**
2. **Access tokens are short-lived (< 1 hour)**
3. **Token refresh handled by Tauri backend**
4. **Frontend receives ephemeral tokens via secure IPC**
5. **Tokens stored in OS-native keychain (not localStorage)**

## Provider Fallback Chain

The sidecar automatically falls back through provider tiers:

```
1. User selects provider → attempt connection
2. If OAuth token expired/unavailable → fall back to API key provider
3. If no API key configured → fall back to Ollama (if available)
4. If all fail → show configuration UI
```

## Testing OAuth Integration

### Prerequisites
- OAuth provider package installed
- OAuth tokens configured in Tauri vault
- Provider enabled in `oauth-providers.ts`

### Manual Testing
```bash
# 1. Build sidecar with OAuth support
cd src-tauri/sidecar-ai
bun install
bun build --target=bun index.ts

# 2. Start sidecar
PORT=47856 bun run index.ts

# 3. Test provider endpoint
curl http://localhost:47856/providers | jq

# Expected: OAuth providers appear in list if enabled
```

### Unit Testing
```typescript
// config/oauth-providers.test.ts
import { describe, expect, test } from "bun:test";
import { shouldIncludeOAuthProviders, getEnabledOAuthProviders } from "./oauth-providers";

describe("OAuth Providers", () => {
  test("returns empty when all disabled", () => {
    expect(shouldIncludeOAuthProviders()).toBe(false);
    expect(getEnabledOAuthProviders()).toHaveLength(0);
  });

  // TODO: Add test for enabled OAuth providers
});
```

## Known Limitations

1. **No OAuth flow implementation**: Token acquisition must be manual
2. **Community package dependency**: Stability not guaranteed
3. **Desktop OAuth complexity**: Redirect flows require workarounds
4. **Limited provider support**: Only 2-3 experimental providers

## Future Work

- [ ] Implement OAuth redirect flow (local server or deep linking)
- [ ] Add token refresh logic in Tauri
- [ ] Create UI for OAuth provider configuration
- [ ] Monitor AI SDK for official OAuth provider support
- [ ] Add OAuth provider tests
- [ ] Document per-provider OAuth setup (Claude Code, OpenCode)

## References

- [AI SDK v6 Community Providers](https://ai-sdk.dev/providers/community-providers)
- [ai-sdk-provider-claude-code](https://github.com/ben-vargas/ai-sdk-provider-claude-code)
- [ai-sdk-provider-opencode-sdk](https://github.com/ben-vargas/ai-sdk-provider-opencode-sdk)
- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)

## Questions?

OAuth integration is experimental and not recommended for production use. For questions or issues:

1. Check the [AI Architecture Improvements Plan](../../../docs/plans/2026-01-17-ai-architecture-improvements.md)
2. Review provider documentation links above
3. Consider using API key providers instead (Tier 1)
