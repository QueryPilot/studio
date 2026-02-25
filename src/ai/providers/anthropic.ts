import { createAnthropic } from "@ai-sdk/anthropic";
import type { ProviderConfig } from "../types";

export const anthropicConfig: ProviderConfig = {
  id: "anthropic",
  name: "Anthropic",
  requiresApiKey: true,
  logo: "/logos/claude-color.svg",
  models: [
    {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      description: "Balanced performance",
    },
    {
      id: "claude-opus-4-6",
      name: "Claude Opus 4.6",
      description: "Most capable",
    },
    {
      id: "claude-haiku-4-5-20251001",
      name: "Claude Haiku 4.5",
      description: "Fastest and cheapest",
    },
  ],
};

export function createAnthropicProvider(apiKey: string) {
  return createAnthropic({ apiKey });
}
