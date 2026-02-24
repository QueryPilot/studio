// src/ai/types.ts
import type { LanguageModel, ModelMessage } from "ai";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "ollama";

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  models: ProviderModelInfo[];
}

export interface ProviderModelInfo {
  id: string;
  name: string;
  description: string;
}

export interface BYOKSession {
  providerId: ProviderId;
  modelId: string;
  provider: LanguageModel;
}

export interface ByokToolCall {
  id: string;
  name: string;
  status: "calling" | "complete" | "error";
}

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onToolCall: (toolCall: { id: string; name: string; input: unknown }) => void;
  onToolResult: (toolCallId: string, result: unknown) => void;
  onFinish: (responseMessages: ModelMessage[]) => void;
  onError: (error: string) => void;
}
