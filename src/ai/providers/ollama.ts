import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderConfig, ProviderModelInfo } from "../types";

export const ollamaConfig: ProviderConfig = {
  id: "ollama",
  name: "Ollama",
  requiresApiKey: false,
  defaultBaseUrl: "http://localhost:11434/v1",
  logo: "/logos/ollama.svg",
  models: [],
  listModels: async () => {
    let res: Response;
    try {
      res = await fetch("http://localhost:11434/api/tags");
    } catch {
      throw new Error(
        "Cannot connect to Ollama. Make sure it's running: ollama serve",
      );
    }
    if (!res.ok) throw new Error(`Ollama responded with ${res.status}`);
    const data = (await res.json()) as {
      models: Array<{
        name: string;
        details?: { parameter_size?: string; family?: string };
      }>;
    };
    return data.models.map(
      (m): ProviderModelInfo => ({
        id: m.name,
        name: m.name,
        description: [m.details?.parameter_size, m.details?.family]
          .filter(Boolean)
          .join(" - ") || "Local model",
      }),
    );
  },
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
