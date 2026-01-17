import type { AIProviderConfig } from "../types";
import {
  getEnabledOAuthProviders,
  shouldIncludeOAuthProviders,
} from "./oauth-providers";

/**
 * API Key-based providers (Tier 1: Primary)
 * These are production-proven and recommended for most users.
 */
export const API_KEY_PROVIDERS: AIProviderConfig[] = [
  {
    name: "openai",
    models: [
      {
        id: "gpt-5-2025-08-07",
        name: "GPT-5",
        contextWindow: 200000,
        pricing: { input: 2.5, output: 10 },
      },
      {
        id: "gpt-5-pro-2025-10-06",
        name: "GPT-5 Pro",
        contextWindow: 400000,
        pricing: { input: 5, output: 15 },
      },
      {
        id: "gpt-5-mini-2025-08-07",
        name: "GPT-5 Mini",
        contextWindow: 128000,
        pricing: { input: 0.15, output: 0.6 },
      },
      {
        id: "gpt-5-nano-2025-08-07",
        name: "GPT-5 Nano",
        contextWindow: 64000,
        pricing: { input: 0.075, output: 0.3 },
      },
      {
        id: "gpt-4.1-2025-04-14",
        name: "GPT-4.1",
        contextWindow: 128000,
        pricing: { input: 2.5, output: 10 },
      },
    ],
    requiresApiKey: true,
    authType: "apiKey",
  },
  {
    name: "anthropic",
    models: [
      {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        contextWindow: 200000,
        pricing: { input: 3, output: 15 },
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        contextWindow: 200000,
        pricing: { input: 0.25, output: 1.25 },
      },
      {
        id: "claude-opus-4-1",
        name: "Claude Opus 4.1",
        contextWindow: 200000,
        pricing: { input: 15, output: 75 },
      },
    ],
    requiresApiKey: true,
    authType: "apiKey",
  },
  {
    name: "google",
    models: [
      {
        id: "gemini-3-pro",
        name: "Gemini 2.5 Pro",
        contextWindow: 1000000,
        pricing: { input: 1.25, output: 5 },
      },
      {
        id: "gemini-3-flash",
        name: "Gemini 2.5 Flash",
        contextWindow: 1000000,
        pricing: { input: 0.075, output: 0.3 },
      },
      {
        id: "gemini-3-flash-lite",
        name: "Gemini 2.5 Flash Lite",
        contextWindow: 1000000,
        pricing: { input: 0.0375, output: 0.15 },
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        contextWindow: 1000000,
        pricing: { input: 0.075, output: 0.3 },
      },
      {
        id: "gemini-2.0-flash-lite",
        name: "Gemini 2.0 Flash Lite",
        contextWindow: 1000000,
        pricing: { input: 0.0375, output: 0.15 },
      },
    ],
    requiresApiKey: true,
    authType: "apiKey",
  },
  {
    name: "xai",
    models: [
      {
        id: "grok-3-latest",
        name: "Grok 3 Latest",
        contextWindow: 128000,
        pricing: { input: 5, output: 15 },
      },
      {
        id: "grok-3-beta",
        name: "Grok 3 Beta",
        contextWindow: 128000,
        pricing: { input: 5, output: 15 },
      },
      {
        id: "grok-3-mini",
        name: "Grok 3 Mini",
        contextWindow: 128000,
        pricing: { input: 0.2, output: 0.6 },
      },
      {
        id: "grok-4-fast",
        name: "Grok 4 Fast",
        contextWindow: 128000,
        pricing: { input: 0.4, output: 1.2 },
      },
      {
        id: "grok-turbo-1-2025",
        name: "Grok Turbo 1",
        contextWindow: 128000,
        pricing: { input: 0.1, output: 0.3 },
      },
    ],
    requiresApiKey: true,
  },
  {
    name: "gateway",
    models: [
      {
        id: "openai/gpt-5-pro-2025-10-06",
        name: "GPT-5 Pro (Gateway)",
        contextWindow: 400000,
        pricing: { input: 5, output: 15 },
      },
      {
        id: "openai/gpt-4.1-2025-04-14",
        name: "GPT-4.1 (Gateway)",
        contextWindow: 128000,
        pricing: { input: 2.5, output: 10 },
      },
      {
        id: "anthropic/claude-sonnet-4-5",
        name: "Claude Sonnet 4.5 (Gateway)",
        contextWindow: 200000,
        pricing: { input: 3, output: 15 },
      },
      {
        id: "anthropic/claude-opus-4-1",
        name: "Claude Opus 4.1 (Gateway)",
        contextWindow: 200000,
        pricing: { input: 15, output: 75 },
      },
      {
        id: "google/gemini-3-pro",
        name: "Gemini 2.5 Pro (Gateway)",
        contextWindow: 1000000,
        pricing: { input: 1.25, output: 5 },
      },
      {
        id: "xai/grok-3-latest",
        name: "Grok 3 (Gateway)",
        contextWindow: 128000,
        pricing: { input: 5, output: 15 },
      },
    ],
    requiresApiKey: true,
  },
  {
    name: "openrouter",
    models: [
      {
        id: "anthropic/claude-3.5-sonnet",
        name: "Claude 3.5 Sonnet",
        contextWindow: 200000,
        pricing: { input: 3, output: 15 },
      },
      {
        id: "anthropic/claude-3-opus",
        name: "Claude 3 Opus",
        contextWindow: 200000,
        pricing: { input: 15, output: 75 },
      },
      {
        id: "openai/gpt-5-pro-2025-10-06",
        name: "GPT-5 Pro",
        contextWindow: 400000,
        pricing: { input: 5, output: 15 },
      },
      {
        id: "openai/gpt-4.1-2025-04-14",
        name: "GPT-4.1",
        contextWindow: 128000,
        pricing: { input: 2.5, output: 10 },
      },
      {
        id: "google/gemini-3-pro-preview",
        name: "Gemini 2.5 Pro Preview",
        contextWindow: 1000000,
        pricing: { input: 1.25, output: 5 },
      },
      {
        id: "meta-llama/llama-3.1-405b-instruct",
        name: "Llama 3.1 405B",
        contextWindow: 128000,
        pricing: { input: 3, output: 3 },
      },
      {
        id: "x-ai/grok-3-beta",
        name: "Grok 3 Beta",
        contextWindow: 128000,
        pricing: { input: 5, output: 15 },
      },
      {
        id: "qwen/qwen-2.5-coder-32b-instruct",
        name: "Qwen 2.5 Coder 32B",
        contextWindow: 32000,
        pricing: { input: 0.2, output: 0.2 },
      },
      {
        id: "deepseek/deepseek-chat",
        name: "DeepSeek Chat",
        contextWindow: 64000,
        pricing: { input: 0.14, output: 0.28 },
      },
    ],
    requiresApiKey: true,
  },
  {
    name: "ollama",
    models: [
      {
        id: "llama3.1",
        name: "Llama 3.1",
        contextWindow: 128000,
      },
      {
        id: "llama3",
        name: "Llama 3",
        contextWindow: 8000,
      },
      {
        id: "codellama",
        name: "Code Llama",
        contextWindow: 16000,
      },
      {
        id: "mistral",
        name: "Mistral",
        contextWindow: 32000,
      },
      {
        id: "qwen2.5",
        name: "Qwen 2.5",
        contextWindow: 32000,
      },
      {
        id: "deepseek-coder",
        name: "DeepSeek Coder",
        contextWindow: 16000,
      },
    ],
    requiresApiKey: false,
    authType: "none",
  },
];

/**
 * Combined provider list with tiered fallback support
 *
 * Tier 1 (Primary): API Key providers - most reliable
 * Tier 2 (Enhanced): OAuth providers - opt-in, experimental
 * Tier 3 (Local): Ollama - offline fallback
 *
 * OAuth providers are only included if explicitly enabled.
 */
export const SUPPORTED_PROVIDERS: AIProviderConfig[] = [
  ...API_KEY_PROVIDERS,
  ...(shouldIncludeOAuthProviders() ? getEnabledOAuthProviders() : []),
];
