import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createGateway } from "@ai-sdk/gateway";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ConfigService } from "./config.service";

type ProviderInstance = ReturnType<typeof createOpenAI>;

const PROVIDER_FACTORIES: Record<string, (apiKey: string) => ProviderInstance> = {
  openai: (apiKey) => createOpenAI({ apiKey }),
  anthropic: (apiKey) => createAnthropic({ apiKey }),
  google: (apiKey) => createGoogleGenerativeAI({ apiKey }),
  xai: (apiKey) => createXai({ apiKey }),
  gateway: (apiKey) => createGateway({ apiKey }),
  openrouter: (apiKey) => createOpenRouter({ apiKey }),
};

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  xai: "xAI",
  gateway: "Vercel AI Gateway",
  openrouter: "OpenRouter",
};

export class ProviderService {
  private static cache = new Map<string, ProviderInstance>();

  static getProvider(provider: string): ProviderInstance {
    const cached = this.cache.get(provider);
    if (cached) return cached;

    const apiKey = ConfigService.getApiKey(provider);
    const factory = PROVIDER_FACTORIES[provider];

    if (!factory) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    if (!apiKey) {
      const name = PROVIDER_NAMES[provider] || provider;
      throw new Error(`${name} API key not configured. Please set it in Settings.`);
    }

    const instance = factory(apiKey);
    this.cache.set(provider, instance);
    return instance;
  }

  static clearCache(): void {
    this.cache.clear();
  }

  static invalidateProvider(provider: string): void {
    this.cache.delete(provider);
  }

  // Legacy alias for backward compatibility
  static createProvider(provider: string): ProviderInstance {
    return this.getProvider(provider);
  }
}
