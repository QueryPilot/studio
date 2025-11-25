import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createGateway } from "@ai-sdk/gateway";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ollama, createOllama } from "ollama-ai-provider";
import { ConfigService } from "./config.service";
import { createProviderRegistry } from "ai";

export class ProviderService {
  static registry = createProviderRegistry({
    openai: createOpenAI({ apiKey: ConfigService.getApiKey("openai") }),
    anthropic: createAnthropic({
      apiKey: ConfigService.getApiKey("anthropic"),
    }),
    google: createGoogleGenerativeAI({
      apiKey: ConfigService.getApiKey("google"),
    }),
    xai: createXai({ apiKey: ConfigService.getApiKey("xai") }),
    gateway: createGateway({ apiKey: ConfigService.getApiKey("gateway") }),
    openrouter: createOpenRouter({
      apiKey: ConfigService.getApiKey("openrouter"),
    }),
    // ollama: createOllama(),
  });

  static createProvider(provider: string) {
    const apiKey = ConfigService.getApiKey(provider);

    switch (provider) {
      case "openai":
        if (!apiKey) {
          throw new Error(
            `OpenAI API key not configured. Please set it in Settings.`,
          );
        }

        return createOpenAI({ apiKey });

      case "anthropic":
        if (!apiKey) {
          throw new Error(
            `Anthropic API key not configured. Please set it in Settings.`,
          );
        }
        return createAnthropic({ apiKey });

      case "google":
        if (!apiKey) {
          throw new Error(
            `Google API key not configured. Please set it in Settings.`,
          );
        }
        return createGoogleGenerativeAI({ apiKey });

      case "xai":
        if (!apiKey) {
          throw new Error(
            `xAI API key not configured. Please set it in Settings.`,
          );
        }
        return createXai({ apiKey });

      case "gateway":
        if (!apiKey) {
          throw new Error(
            `Vercel AI Gateway API key not configured. Please set it in Settings.`,
          );
        }
        return createGateway({ apiKey });

      case "openrouter":
        if (!apiKey) {
          throw new Error(
            `OpenRouter API key not configured. Please set it in Settings.`,
          );
        }
        return createOpenRouter({ apiKey });

      // case "ollama":
      //   // Ollama doesn't need an API key (local)
      //   return ollama;

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
}
