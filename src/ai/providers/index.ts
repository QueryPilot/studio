import type { LanguageModel } from "ai";
import type { ProviderId, ProviderConfig } from "../types";
import { openaiConfig, createOpenAIProvider } from "./openai";
import { anthropicConfig, createAnthropicProvider } from "./anthropic";
import { googleConfig, createGoogleProvider } from "./google";
import { mistralConfig, createMistralProvider } from "./mistral";
import { ollamaConfig, createOllamaProvider } from "./ollama";

export const PROVIDER_CONFIGS: Record<ProviderId, ProviderConfig> = {
  openai: openaiConfig,
  anthropic: anthropicConfig,
  google: googleConfig,
  mistral: mistralConfig,
  ollama: ollamaConfig,
};

export function createModel(
  providerId: ProviderId,
  modelId: string,
  apiKey?: string,
): LanguageModel {
  const config = PROVIDER_CONFIGS[providerId];
  if (config.requiresApiKey && !apiKey) {
    throw new Error(`Provider "${config.name}" requires an API key`);
  }

  switch (providerId) {
    case "openai":
      return createOpenAIProvider(apiKey ?? "")(modelId);
    case "anthropic":
      return createAnthropicProvider(apiKey ?? "")(modelId);
    case "google":
      return createGoogleProvider(apiKey ?? "")(modelId);
    case "mistral":
      return createMistralProvider(apiKey ?? "")(modelId);
    case "ollama":
      return createOllamaProvider()(modelId);
  }
}

