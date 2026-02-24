import { createOllama } from "ollama-ai-provider";
import type { ProviderConfig } from "../types";

export const ollamaConfig: ProviderConfig = {
  id: "ollama",
  name: "Ollama (Local)",
  requiresApiKey: false,
  defaultBaseUrl: "http://localhost:11434/api",
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

export function createOllamaProvider(baseUrl?: string) {
  return createOllama({ baseURL: baseUrl ?? ollamaConfig.defaultBaseUrl });
}
