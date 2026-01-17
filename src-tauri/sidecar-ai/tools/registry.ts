/**
 * Tool Registry
 *
 * Central registry for all tools with:
 * - Auto-loading and registration
 * - Capability-based filtering
 * - Connection-specific tool lists
 * - Capability caching
 */

import type { RegisteredTool, Capability, TauriClient } from "./types";

/**
 * Capability result from ai_get_capabilities command
 */
interface CapabilityResult {
  kind: string;
  capabilities: string[];
  error?: string;
  fallback_tools: string[];
}

/**
 * Tool Registry for managing and filtering tools
 */
export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private capabilityCache = new Map<string, CapabilityResult>();

  /**
   * Register a tool
   */
  register(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Unregister a tool by name
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Get a tool by name
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get tools filtered by capabilities (OR logic)
   *
   * Returns tools that support ANY of the given capabilities.
   */
  getForCapabilities(capabilities: string[]): RegisteredTool[] {
    if (capabilities.length === 0) {
      return [];
    }

    return this.getAll().filter((tool) =>
      tool.capabilities.some((cap) => capabilities.includes(cap))
    );
  }

  /**
   * Get tools available for a specific connection
   *
   * Fetches capabilities from the backend and filters tools accordingly.
   * Results are cached per connection.
   */
  async getToolsForConnection(
    connectionId: string,
    tauri: TauriClient
  ): Promise<RegisteredTool[]> {
    // Check cache first
    let capResult = this.capabilityCache.get(connectionId);

    if (!capResult) {
      // Fetch capabilities from backend
      try {
        capResult = await tauri.invoke<CapabilityResult>("ai_get_capabilities", {
          connId: connectionId,
        });
        // Cache the result
        this.capabilityCache.set(connectionId, capResult);
      } catch (error) {
        console.warn(`Failed to get capabilities for ${connectionId}:`, error);
        // Return all tools as fallback
        return this.getAll();
      }
    }

    // Map kind to capability
    const capabilityMap: Record<string, Capability> = {
      sql: "sql",
      document: "document",
      keyvalue: "keyvalue",
    };

    const capability = capabilityMap[capResult.kind];

    if (!capability) {
      // Unknown kind or error - return all tools
      return this.getAll();
    }

    // Filter tools by capability
    return this.getForCapabilities([capability]);
  }

  /**
   * Clear capability cache for a connection
   */
  clearCapabilityCache(connectionId?: string): void {
    if (connectionId) {
      this.capabilityCache.delete(connectionId);
    } else {
      this.capabilityCache.clear();
    }
  }

  /**
   * Get registry statistics
   */
  stats() {
    const toolsByCategory = new Map<string, number>();
    const toolsByCapability = new Map<string, number>();

    for (const tool of this.tools.values()) {
      // Count by category
      const catCount = toolsByCategory.get(tool.category) || 0;
      toolsByCategory.set(tool.category, catCount + 1);

      // Count by capability
      for (const cap of tool.capabilities) {
        const capCount = toolsByCapability.get(cap) || 0;
        toolsByCapability.set(cap, capCount + 1);
      }
    }

    return {
      totalTools: this.tools.size,
      toolsByCategory: Object.fromEntries(toolsByCategory),
      toolsByCapability: Object.fromEntries(toolsByCapability),
      cachedConnections: this.capabilityCache.size,
    };
  }
}

// Global registry instance
export const registry = new ToolRegistry();
