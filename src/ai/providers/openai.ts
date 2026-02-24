import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderConfig } from "../types";

export const openaiConfig: ProviderConfig = {
  id: "openai",
  name: "OpenAI",
  requiresApiKey: true,
  models: [
    { id: "gpt-4o", name: "GPT-4o", description: "Flagship multimodal model" },
    {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini",
      description: "Fast and affordable",
    },
    { id: "o1", name: "o1", description: "Reasoning model" },
    { id: "o3-mini", name: "o3-mini", description: "Fast reasoning" },
  ],
};

export function createOpenAIProvider(apiKey: string) {
  return createOpenAI({ apiKey });
}
