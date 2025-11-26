import { logger } from "@/lib/logger";
import { AI_SIDECAR_URL } from "@/config/constants";

export interface AIModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  pricing?: {
    input: number;  // per million tokens
    output: number; // per million tokens
  };
}

export interface AIProviderConfig {
  name: string;
  models: AIModelInfo[];
  requiresApiKey: boolean;
}

export interface SidecarHealthResponse {
  status: string;
  uptime?: number;
}

export interface ProvidersResponse {
  providers: AIProviderConfig[];
}

/**
 * Check if the AI sidecar is healthy and reachable
 */
export async function checkSidecarHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${AI_SIDECAR_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });

    if (!response.ok) {
      logger.warn("[AIService] Sidecar health check failed:", response.status);
      return false;
    }

    const data: SidecarHealthResponse = await response.json();
    return data.status === "ok";
  } catch (error) {
    logger.warn("[AIService] Sidecar not reachable:", error);
    return false;
  }
}

/**
 * Fetch available AI providers and their models from the sidecar
 */
export async function getChatProviders(): Promise<AIProviderConfig[]> {
  try {
    const response = await fetch(`${AI_SIDECAR_URL}/providers`, {
      method: "GET",
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      logger.error("[AIService] Failed to fetch providers:", response.status);
      return [];
    }

    // Backend returns array directly, not wrapped in object
    const data: AIProviderConfig[] = await response.json();
    return data || [];
  } catch (error) {
    logger.error("[AIService] Error fetching providers:", error);
    return [];
  }
}

export interface SidecarStatusResponse {
  status: string;
  configLoaded: boolean;
  configuredProviders: string[];
}

/**
 * Get the sidecar status including configured providers
 */
export async function getSidecarStatus(): Promise<SidecarStatusResponse | null> {
  try {
    const response = await fetch(`${AI_SIDECAR_URL}/status`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    logger.error("[AIService] Error fetching status:", error);
    return null;
  }
}

/**
 * Check if a specific provider has an API key configured on the sidecar
 */
export async function isProviderConfigured(
  providerName: string,
): Promise<boolean> {
  const status = await getSidecarStatus();
  if (!status) return false;
  return status.configuredProviders.includes(providerName);
}

export interface TextToSQLRequest {
  prompt: string;
  columns: Array<{
    name: string;
    dataType: string;
    nullable: boolean;
    enumValues?: string[];
  }>;
  tableName: string;
  dialect: "postgresql" | "mysql" | "sqlite" | "mssql";
  provider: string;
  model: string;
}

export interface TextToSQLResponse {
  whereClause?: string;
  explanation?: string;
  error?: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  pricing: {
    prompt: number;
    completion: number;
  };
  modality: string;
}

export interface OpenRouterModelsResponse {
  models: OpenRouterModel[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Search OpenRouter models
 */
export async function searchOpenRouterModels(
  query?: string,
  limit = 50,
  offset = 0,
): Promise<OpenRouterModelsResponse | null> {
  try {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    params.set("limit", limit.toString());
    params.set("offset", offset.toString());

    const response = await fetch(
      `${AI_SIDECAR_URL}/openrouter-models?${params.toString()}`,
      {
        method: "GET",
        signal: AbortSignal.timeout(10000), // 10 second timeout
      },
    );

    if (!response.ok) {
      logger.error(
        "[AIService] Failed to fetch OpenRouter models:",
        response.status,
      );
      return null;
    }

    return await response.json();
  } catch (error) {
    logger.error("[AIService] Error fetching OpenRouter models:", error);
    return null;
  }
}

/**
 * Convert natural language to SQL WHERE clause using AI
 */
export async function textToSQL(
  params: TextToSQLRequest,
): Promise<TextToSQLResponse> {
  try {
    const response = await fetch(`${AI_SIDECAR_URL}/text-to-sql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30000), // 30 second timeout for AI
    });

    const data = await response.json();

    if (!response.ok) {
      return { error: data.error || "Failed to generate SQL" };
    }

    return {
      whereClause: data.whereClause,
      explanation: data.explanation,
    };
  } catch (error) {
    logger.error("[AIService] Text-to-SQL error:", error);
    return {
      error: error instanceof Error ? error.message : "Failed to generate SQL",
    };
  }
}

