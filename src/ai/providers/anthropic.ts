import { createAnthropic } from "@ai-sdk/anthropic";
import type { ProviderConfig } from "../types";

export const anthropicConfig: ProviderConfig = {
  id: "anthropic",
  name: "Anthropic",
  requiresApiKey: true,
  logo: "/logos/claude-color.svg",
  models: [
    {
      id: "claude-sonnet-4-20250514",
      name: "Claude Sonnet 4",
      description: "Best for everyday tasks",
    },
    {
      id: "claude-opus-4-20250514",
      name: "Claude Opus 4",
      description: "Most capable",
    },
    {
      id: "claude-haiku-3-5-20241022",
      name: "Claude Haiku 3.5",
      description: "Fastest",
    },
  ],
};

export function createAnthropicProvider(apiKey: string) {
  return createAnthropic({ apiKey });
}
