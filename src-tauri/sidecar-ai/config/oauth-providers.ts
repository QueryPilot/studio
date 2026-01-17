/**
 * OAuth Provider Configurations (Experimental)
 *
 * These providers use OAuth authentication instead of API keys.
 * Marked as experimental due to dependency on community-maintained packages.
 *
 * References:
 * - https://github.com/ben-vargas/ai-sdk-provider-claude-code
 * - https://github.com/ben-vargas/ai-sdk-provider-opencode-sdk
 * - https://ai-sdk.dev/providers/community-providers/claude-code
 */

import type { AIProviderConfig } from "../types";

/**
 * OAuth providers are Tier 2 (Enhanced) in the provider strategy.
 * They offer potential benefits but add complexity and require token management.
 *
 * Current Status: DISABLED by default
 * Reason: Community packages are untested at scale, OAuth adds complexity for desktop app
 *
 * To enable:
 * 1. Install package: npm install ai-sdk-provider-claude-code
 * 2. Implement token management in Tauri (see oauth-token-manager.ts stub)
 * 3. Set oauthConfig.enabled = true
 * 4. Update chat route to handle OAuth token injection
 */
export const OAUTH_PROVIDERS: AIProviderConfig[] = [
  {
    name: "claude-code",
    models: [
      {
        id: "claude-code-latest",
        name: "Claude Code (Latest)",
        contextWindow: 200000,
        pricing: { input: 3, output: 15 },
      },
    ],
    requiresApiKey: false,
    authType: "oauth",
    oauthConfig: {
      enabled: true,
      status: "experimental",
      note: "Requires ai-sdk-provider-claude-code package and OAuth token management",
    },
  },
  {
    name: "opencode",
    models: [
      {
        id: "opencode-latest",
        name: "OpenCode (Latest)",
        contextWindow: 200000,
        pricing: { input: 2.5, output: 10 },
      },
    ],
    requiresApiKey: false,
    authType: "oauth",
    oauthConfig: {
      enabled: true,
      status: "experimental",
      note: "Requires ai-sdk-provider-opencode-sdk package and OpenCode CLI configured",
    },
  },
];

/**
 * OAuth Token Management (Stub)
 *
 * Future implementation should:
 * 1. Store OAuth tokens in Tauri's secure vault
 * 2. Implement token refresh logic
 * 3. Handle OAuth redirect flow (desktop app challenge)
 * 4. Pass short-lived access tokens to sidecar
 *
 * Security considerations:
 * - Sidecar should NEVER persist refresh tokens
 * - Access tokens should be short-lived (< 1 hour)
 * - Token refresh handled by Tauri backend
 * - Frontend receives ephemeral tokens via secure IPC
 */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string; // Never sent to sidecar
  expiresAt: number;
  provider: string;
}

/**
 * Check if OAuth providers should be included in the provider list
 */
export function shouldIncludeOAuthProviders(): boolean {
  // Check if any OAuth provider is enabled
  return OAUTH_PROVIDERS.some((p) => p.oauthConfig?.enabled === true);
}

/**
 * Get enabled OAuth providers
 */
export function getEnabledOAuthProviders(): AIProviderConfig[] {
  return OAUTH_PROVIDERS.filter((p) => p.oauthConfig?.enabled === true);
}
