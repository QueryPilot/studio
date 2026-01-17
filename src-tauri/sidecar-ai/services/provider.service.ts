import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createGateway } from "@ai-sdk/gateway";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createClaudeCode } from "ai-sdk-provider-claude-code";
import { createOpencode } from "ai-sdk-provider-opencode-sdk";
import { ConfigService } from "./config.service";

type ProviderInstance = ReturnType<typeof createOpenAI>;

interface ProviderConfig {
  id: string;
  name: string;
  tier: number;
  requiresApiKey: boolean;
  experimental?: boolean;
  fallback?: string;
  factory?: (apiKey: string) => ProviderInstance;
}

interface ProviderResult {
  provider: ProviderInstance;
  providerId: string;
  usedFallback: boolean;
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    tier: 1,
    requiresApiKey: true,
    factory: (apiKey) => createOpenAI({ apiKey }),
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    tier: 1,
    requiresApiKey: true,
    factory: (apiKey) => createAnthropic({ apiKey }),
  },
  google: {
    id: "google",
    name: "Google",
    tier: 1,
    requiresApiKey: true,
    factory: (apiKey) => createGoogleGenerativeAI({ apiKey }),
  },
  xai: {
    id: "xai",
    name: "xAI",
    tier: 1,
    requiresApiKey: true,
    factory: (apiKey) => createXai({ apiKey }),
  },
  gateway: {
    id: "gateway",
    name: "Vercel AI Gateway",
    tier: 1,
    requiresApiKey: true,
    factory: (apiKey) => createGateway({ apiKey }),
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    tier: 1,
    requiresApiKey: true,
    factory: (apiKey) => createOpenRouter({ apiKey }),
  },
  "claude-code": {
    id: "claude-code",
    name: "Claude Code (OAuth)",
    tier: 2,
    requiresApiKey: false,
    experimental: true,
    fallback: "anthropic",
    factory: () => createClaudeCode(),
  },
  opencode: {
    id: "opencode",
    name: "OpenCode (OAuth)",
    tier: 2,
    requiresApiKey: false,
    experimental: true,
    factory: () => createOpencode(),
  },
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    tier: 3,
    requiresApiKey: false,
  },
};

export class ProviderService {
  private static cache = new Map<string, ProviderInstance>();

  /**
   * Get a provider instance
   * Throws if provider is unknown or API key is missing
   */
  static getProvider(providerId: string): ProviderInstance {
    const cached = this.cache.get(providerId);
    if (cached) return cached;

    const config = PROVIDER_CONFIGS[providerId];

    if (!config) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    if (config.requiresApiKey) {
      const apiKey = ConfigService.getApiKey(providerId);
      if (!apiKey) {
        throw new Error(`${config.name} API key not configured. Please set it in Settings.`);
      }

      if (!config.factory) {
        throw new Error(`Provider ${providerId} has no factory configured`);
      }

      const instance = config.factory(apiKey);
      this.cache.set(providerId, instance);
      return instance;
    }

    // For providers that don't require API key (OAuth/experimental/local)
    if (config.factory) {
      const instance = config.factory("");
      this.cache.set(providerId, instance);
      return instance;
    }

    throw new Error(`Provider ${providerId} not yet implemented`);
  }

  /**
   * Get a provider with automatic fallback
   * Returns the provider instance along with metadata about which provider was used
   */
  static async getProviderWithFallback(
    primaryId: string,
    fallbackId?: string
  ): Promise<ProviderResult> {
    const config = PROVIDER_CONFIGS[primaryId];

    if (!config) {
      throw new Error(`Unknown provider: ${primaryId}`);
    }

    // Try primary provider
    try {
      const provider = this.getProvider(primaryId);
      return {
        provider,
        providerId: primaryId,
        usedFallback: false,
      };
    } catch (primaryError) {
      // If fallback is specified, try it
      const fallback = fallbackId || config.fallback;

      if (!fallback) {
        throw primaryError;
      }

      try {
        const provider = this.getProvider(fallback);
        return {
          provider,
          providerId: fallback,
          usedFallback: true,
        };
      } catch (fallbackError) {
        throw new Error(
          `Both primary (${primaryId}) and fallback (${fallback}) providers failed`
        );
      }
    }
  }

  /**
   * List all available provider configurations
   */
  static listProviders(): ProviderConfig[] {
    return Object.values(PROVIDER_CONFIGS);
  }

  /**
   * Get providers that are currently available (have API keys configured or don't need them)
   */
  static getAvailableProviders(): ProviderConfig[] {
    return this.listProviders().filter((config) => {
      if (!config.requiresApiKey) {
        return true;
      }

      const apiKey = ConfigService.getApiKey(config.id);
      return !!apiKey;
    });
  }

  /**
   * Clear all cached provider instances
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * Invalidate a specific provider's cache
   */
  static invalidateProvider(providerId: string): void {
    this.cache.delete(providerId);
  }

  /**
   * Legacy alias for backward compatibility
   */
  static createProvider(providerId: string): ProviderInstance {
    return this.getProvider(providerId);
  }
}
