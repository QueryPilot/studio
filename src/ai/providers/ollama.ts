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
// with a custom baseURL. We return `provider.chat` to force the
// /chat/completions endpoint — the default `provider(modelId)` would use
// the OpenAI Responses API (/responses) which Ollama doesn't support.
export function createOllamaProvider(baseUrl?: string) {
  const provider = createOpenAI({
    baseURL: baseUrl ?? ollamaConfig.defaultBaseUrl,
    apiKey: "ollama", // Ollama ignores the API key but the SDK requires one
  });
  // Bind .chat so the method keeps its provider context when called
  // separately (avoids @typescript-eslint/unbound-method)
  return provider.chat.bind(provider);
}
