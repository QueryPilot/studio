import type { AIProviderConfig } from "../types";

export const SUPPORTED_PROVIDERS: AIProviderConfig[] = [
  {
    name: "openai",
    models: [
      "gpt-5-2025-08-07",
      "gpt-5-pro-2025-10-06",
      "gpt-5-mini-2025-08-07",
      "gpt-5-nano-2025-08-07",
      "gpt-4.1-2025-04-14",
    ],
    requiresApiKey: true,
  },
  {
    name: "anthropic",
    models: [
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
      "claude-opus-4-1",
    ],
    requiresApiKey: true,
  },
  {
    name: "google",
    models: [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
    ],
    requiresApiKey: true,
  },
  {
    name: "ollama",
    models: [
      "llama3.1",
      "llama3",
      "codellama",
      "mistral",
      "qwen2.5",
      "deepseek-coder",
    ],
    requiresApiKey: false,
  },
];
