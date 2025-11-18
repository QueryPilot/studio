export interface ChatRequest {
  messages: Array<any>; // Accept UIMessage[] from AI SDK
  provider: "openai" | "anthropic" | "google" | "ollama";
  model: string;
  apiKey?: string;
  connectionId?: string;
}

export interface AIProviderConfig {
  name: string;
  models: string[];
  requiresApiKey: boolean;
}

export interface StatusResponse {
  status: string;
  configLoaded: boolean;
  configuredProviders: string[];
}

export interface ConfigRequest {
  [provider: string]: string | boolean | undefined;
  // Sentry configuration (optional)
  sentryEnabled?: boolean;
  sentryDsn?: string;
}

export interface ConfigResponse {
  status: string;
  configured: string[];
}
