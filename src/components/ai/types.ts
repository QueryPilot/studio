export type AIProvider = "anthropic" | "openai";

export interface AIModel {
  id: string;
  name: string;
  provider: AIProvider;
  description?: string;
  isDefault?: boolean;
  isCurrent?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  mentions?: TableMention[];
  model?: string;
}

export interface TableMention {
  table: string;
  schema?: string;
  position: number;
}

export const AI_MODELS: AIModel[] = [
  // Claude Models
  {
    id: "claude-default",
    name: "Opus x Sonnet",
    provider: "anthropic",
    description: "Opus 4.1 for up to 50% of usage limits, then Sonnet 4",
    isDefault: true,
  },
  {
    id: "claude-opus",
    name: "Opus",
    provider: "anthropic",
    description: "Opus 4.1 for complex tasks • Reaches usage limits faster",
  },
  {
    id: "claude-sonnet",
    name: "Sonnet",
    provider: "anthropic",
    description: "Sonnet 4 for daily use",
  },

  // OpenAI Models
  {
    id: "gpt-5-codex-low",
    name: "GPT-5 Codex Low",
    provider: "openai",
    description: "Fast code generation",
  },
  {
    id: "gpt-5-codex-medium",
    name: "GPT-5 Codex Medium",
    provider: "openai",
    description: "Balanced code generation",
  },
  {
    id: "gpt-5-codex-high",
    name: "GPT-5 Codex High",
    provider: "openai",
    description: "Advanced code generation",
    isDefault: true,
  },
  {
    id: "gpt-5-minimal",
    name: "GPT-5 Minimal",
    provider: "openai",
    description: "Fastest responses with limited reasoning",
  },
  {
    id: "gpt-5-low",
    name: "GPT-5 Low",
    provider: "openai",
    description: "Balances speed with some reasoning",
  },
  {
    id: "gpt-5-medium",
    name: "GPT-5 Medium",
    provider: "openai",
    description: "Solid balance of reasoning depth and latency",
  },
  {
    id: "gpt-5-high",
    name: "GPT-5 High",
    provider: "openai",
    description: "Maximizes reasoning depth for complex problems",
  },
];

// Default model is Opus x Sonnet
// @ts-expect-error - Default model is Opus x Sonnet
export const DEFAULT_MODEL: AIModel =
  AI_MODELS.find((m) => m.id === "claude-default") || AI_MODELS[0];
