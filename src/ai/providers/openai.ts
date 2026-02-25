import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderConfig, ProviderModelInfo } from "../types";

export const openaiConfig: ProviderConfig = {
  id: "openai",
  name: "OpenAI",
  requiresApiKey: true,
  logo: "/logos/openai.svg",
  models: [
    { id: "o3", name: "o3", description: "Advanced reasoning" },
    { id: "o3-mini", name: "o3-mini", description: "Fast reasoning" },
    { id: "o4-mini", name: "o4-mini", description: "Cost-efficient reasoning" },
    { id: "gpt-4o", name: "GPT-4o", description: "Flagship multimodal" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", description: "Fast and affordable" },
  ],
  listModels: async (apiKey) => {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
    const data = (await res.json()) as {
      data: Array<{ id: string; owned_by: string }>;
    };
    const chatPrefixes = ["gpt-4", "gpt-3.5", "o1", "o3", "o4", "chatgpt"];
    return data.data
      .filter((m) => chatPrefixes.some((p) => m.id.startsWith(p)))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(
        (m): ProviderModelInfo => ({
          id: m.id,
          name: m.id,
          description: m.owned_by,
        }),
      );
  },
};

export function createOpenAIProvider(apiKey: string) {
  return createOpenAI({ apiKey });
}
