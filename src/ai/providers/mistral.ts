import { createMistral } from "@ai-sdk/mistral";
import type { ProviderConfig, ProviderModelInfo } from "../types";

export const mistralConfig: ProviderConfig = {
  id: "mistral",
  name: "Mistral",
  requiresApiKey: true,
  models: [
    {
      id: "mistral-large-latest",
      name: "Mistral Large",
      description: "Most capable",
    },
    {
      id: "mistral-small-latest",
      name: "Mistral Small",
      description: "Fast and efficient",
    },
    {
      id: "codestral-latest",
      name: "Codestral",
      description: "Optimized for code",
    },
  ],
  listModels: async (apiKey) => {
    const res = await fetch("https://api.mistral.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
    const data = (await res.json()) as {
      data: Array<{ id: string; owned_by?: string }>;
    };
    return data.data
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(
        (m): ProviderModelInfo => ({
          id: m.id,
          name: m.id,
          description: m.owned_by ?? "Mistral AI",
        }),
      );
  },
};

export function createMistralProvider(apiKey: string) {
  return createMistral({ apiKey });
}
