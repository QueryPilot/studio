import { createMistral } from "@ai-sdk/mistral";
import type { ProviderConfig } from "../types";

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
};

export function createMistralProvider(apiKey: string) {
  return createMistral({ apiKey });
}
