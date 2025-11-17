import { AI_SIDECAR_URL } from "@/config/constants";

export interface AIProviderConfig {
  name: string;
  models: string[];
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
      console.warn("[AIService] Sidecar health check failed:", response.status);
      return false;
    }

    const data: SidecarHealthResponse = await response.json();
    return data.status === "ok";
  } catch (error) {
    console.warn("[AIService] Sidecar not reachable:", error);
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
      console.error("[AIService] Failed to fetch providers:", response.status);
      return [];
    }

    // Backend returns array directly, not wrapped in object
    const data: AIProviderConfig[] = await response.json();
    return data || [];
  } catch (error) {
    console.error("[AIService] Error fetching providers:", error);
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
    console.error("[AIService] Error fetching status:", error);
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

