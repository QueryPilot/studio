/**
 * Provider Service Tests
 *
 * Tests for provider registry with tiered fallback support.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import { ProviderService } from "./provider.service";
import { ConfigService } from "./config.service";

// Test helper to set individual API keys
function setTestApiKey(provider: string, key: string) {
  ConfigService.setApiKeys({ [provider]: key });
}

describe("ProviderService", () => {
  beforeEach(() => {
    ProviderService.clearCache();
    // Clear all API keys between tests
    ConfigService.clearApiKeys();
  });

  describe("getProvider", () => {
    it("should return provider instance for valid provider with API key", () => {
      // Mock ConfigService to return API key
      setTestApiKey("openai", "test-key");

      const provider = ProviderService.getProvider("openai");
      expect(provider).toBeDefined();
    });

    it("should throw error for unknown provider", () => {
      expect(() => ProviderService.getProvider("invalid")).toThrow("Unknown provider");
    });

    it("should throw error when API key is missing", () => {
      // Ensure no API key is set
      setTestApiKey("anthropic", "");

      expect(() => ProviderService.getProvider("anthropic")).toThrow("API key not configured");
    });

    it("should cache provider instances", () => {
      setTestApiKey("openai", "test-key");

      const p1 = ProviderService.getProvider("openai");
      const p2 = ProviderService.getProvider("openai");

      // Should return same instance
      expect(p1).toBe(p2);
    });
  });

  describe("listProviders", () => {
    it("should return list of available providers", () => {
      const providers = ProviderService.listProviders();

      expect(providers.length).toBeGreaterThan(0);
      expect(providers.some((p) => p.id === "openai")).toBe(true);
      expect(providers.some((p) => p.id === "anthropic")).toBe(true);
    });

    it("should include tier information", () => {
      const providers = ProviderService.listProviders();

      const openai = providers.find((p) => p.id === "openai");
      expect(openai?.tier).toBe(1);

      // If ollama is configured
      const ollama = providers.find((p) => p.id === "ollama");
      if (ollama) {
        expect(ollama.tier).toBe(3);
      }
    });

    it("should include requiresApiKey flag", () => {
      const providers = ProviderService.listProviders();

      const openai = providers.find((p) => p.id === "openai");
      expect(openai?.requiresApiKey).toBe(true);

      const ollama = providers.find((p) => p.id === "ollama");
      if (ollama) {
        expect(ollama.requiresApiKey).toBe(false);
      }
    });
  });

  describe("getProviderWithFallback", () => {
    it("should return primary provider when available", async () => {
      setTestApiKey("openai", "test-key");

      const result = await ProviderService.getProviderWithFallback("openai");

      expect(result.provider).toBeDefined();
      expect(result.providerId).toBe("openai");
      expect(result.usedFallback).toBe(false);
    });

    it("should fallback to specified provider when primary fails", async () => {
      // Primary has no API key
      setTestApiKey("claudeCode", "");
      // Fallback has API key
      setTestApiKey("anthropic", "test-key");

      const result = await ProviderService.getProviderWithFallback("claudeCode", "anthropic");

      expect(result.provider).toBeDefined();
      expect(result.providerId).toBe("anthropic");
      expect(result.usedFallback).toBe(true);
    });

    it("should throw when both primary and fallback fail", async () => {
      setTestApiKey("claudeCode", "");
      setTestApiKey("anthropic", "");

      await expect(
        ProviderService.getProviderWithFallback("claudeCode", "anthropic")
      ).rejects.toThrow();
    });
  });

  describe("getAvailableProviders", () => {
    it("should return only providers with configured API keys", () => {
      setTestApiKey("openai", "test-key");
      setTestApiKey("anthropic", "test-key");
      setTestApiKey("google", "");

      const available = ProviderService.getAvailableProviders();

      expect(available.map((p) => p.id)).toContain("openai");
      expect(available.map((p) => p.id)).toContain("anthropic");
      expect(available.map((p) => p.id)).not.toContain("google");
    });

    it("should include providers that don't require API keys", () => {
      // Clear all API keys
      ProviderService.clearCache();

      const available = ProviderService.getAvailableProviders();

      // Ollama (if configured) doesn't require API key
      const hasOllama = available.some((p) => p.id === "ollama");
      if (hasOllama) {
        expect(available.find((p) => p.id === "ollama")?.requiresApiKey).toBe(false);
      }
    });
  });

  describe("clearCache", () => {
    it("should clear all cached providers", () => {
      setTestApiKey("openai", "test-key");

      // Cache a provider
      const p1 = ProviderService.getProvider("openai");

      ProviderService.clearCache();

      // Should create new instance
      const p2 = ProviderService.getProvider("openai");

      expect(p1).not.toBe(p2);
    });
  });

  describe("invalidateProvider", () => {
    it("should invalidate specific provider cache", () => {
      setTestApiKey("openai", "test-key");
      setTestApiKey("anthropic", "test-key");

      const openai1 = ProviderService.getProvider("openai");
      const anthropic1 = ProviderService.getProvider("anthropic");

      ProviderService.invalidateProvider("openai");

      const openai2 = ProviderService.getProvider("openai");
      const anthropic2 = ProviderService.getProvider("anthropic");

      // OpenAI should be new instance
      expect(openai1).not.toBe(openai2);
      // Anthropic should be same instance
      expect(anthropic1).toBe(anthropic2);
    });
  });
});
