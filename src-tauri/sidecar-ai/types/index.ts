export interface WorkspaceContext {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
  activeTable: string | null;
  activeCollection: string | null;
  activeKey: string | null;
  activeQuery: string | null;
  recentTables: string[];
  recentCollections: string[];
  recentKeys: string[];
  lastAction: "browse" | "query" | "filter" | null;
}

export interface ChatRequest {
  messages: Array<any>; // Accept UIMessage[] from AI SDK
  provider: "openai" | "anthropic" | "google" | "xai" | "gateway" | "openrouter" | "ollama";
  model: string;
  apiKey?: string;
  connectionId?: string;
  context?: WorkspaceContext;
}

export interface AIModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  pricing?: {
    input: number;  // per million tokens
    output: number; // per million tokens
  };
}

export type AuthType = "apiKey" | "oauth" | "none";

export interface AIProviderConfig {
  name: string;
  models: AIModelInfo[];
  requiresApiKey: boolean;
  authType?: AuthType;
  oauthConfig?: {
    enabled: boolean;
    status: "available" | "experimental" | "disabled";
    note?: string;
  };
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
