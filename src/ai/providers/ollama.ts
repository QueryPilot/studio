import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderConfig } from "../types";

export const ollamaConfig: ProviderConfig = {
  id: "ollama",
  name: "Ollama (Local)",
  requiresApiKey: false,
  defaultBaseUrl: "http://localhost:11434/v1",
  models: [
    {
      id: "qwen2.5-coder:7b",
      name: "Qwen 2.5 Coder 7B",
      description: "Recommended for coding",
    },
    {
      id: "llama3.1:8b",
      name: "Llama 3.1 8B",
      description: "General purpose",
    },
    {
      id: "deepseek-coder-v2:16b",
      name: "DeepSeek Coder V2",
      description: "Strong at code",
    },
  ],
};

// Ollama exposes an OpenAI-compatible API at /v1, so we reuse @ai-sdk/openai
// with a custom baseURL. This returns a proper LanguageModelV3, unlike the
// community ollama-ai-provider which is stuck on LanguageModelV1.
export function createOllamaProvider(baseUrl?: string) {
  return createOpenAI({
    baseURL: baseUrl ?? ollamaConfig.defaultBaseUrl,
    apiKey: "ollama", // Ollama ignores the API key but the SDK requires one
  });
}
