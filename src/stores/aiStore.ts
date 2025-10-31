import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AIProviderConfig {
  name: string;
  models: string[];
  requiresApiKey: boolean;
}

interface AIStoreState {
  // Current provider for settings
  selectedProvider: string;
  setSelectedProvider: (provider: string) => void;

  // Default model per provider (set in settings)
  defaultModels: Record<string, string>;
  setDefaultModel: (provider: string, model: string) => void;

  // Active model for current chat (can be different from default)
  activeModel: string;
  setActiveModel: (model: string) => void;

  // Cached providers list
  providers: AIProviderConfig[];
  setProviders: (providers: AIProviderConfig[]) => void;

  // Get configured providers (with API keys set)
  configuredProviders: string[];
  addConfiguredProvider: (provider: string) => void;
  removeConfiguredProvider: (provider: string) => void;
  setConfiguredProviders: (providers: string[]) => void;
  
  // Initialization flag
  isInitialized: boolean;
  setInitialized: (initialized: boolean) => void;
}

export const useAIStore = create<AIStoreState>()(
  persist(
    (set, get) => ({
      selectedProvider: "openai",
      setSelectedProvider: (provider: string) => {
        set({ selectedProvider: provider });
      },

      defaultModels: {
        openai: "gpt-5-2025-08-07",
        anthropic: "claude-sonnet-4-5",
        google: "gemini-2.5-pro",
        ollama: "llama3.1",
      },
      setDefaultModel: (provider: string, model: string) => {
        set((state) => ({
          defaultModels: { ...state.defaultModels, [provider]: model },
        }));
      },

      activeModel: "gpt-5-2025-08-07",
      setActiveModel: (model: string) => {
        set({ activeModel: model });
      },

      providers: [],
      setProviders: (providers: AIProviderConfig[]) => {
        set({ providers });
      },

      configuredProviders: [],
      addConfiguredProvider: (provider: string) => {
        set((state) => ({
          configuredProviders: Array.from(
            new Set([...state.configuredProviders, provider]),
          ),
        }));
      },
      removeConfiguredProvider: (provider: string) => {
        set((state) => ({
          configuredProviders: state.configuredProviders.filter(
            (p) => p !== provider,
          ),
        }));
      },
      setConfiguredProviders: (providers: string[]) => {
        set({ configuredProviders: providers });
      },

      isInitialized: false,
      setInitialized: (initialized: boolean) => {
        set({ isInitialized: initialized });
      },
    }),
    {
      name: "ai-store",
      version: 4,
      migrate: (state, version) => {
        // Migrate from old structure
        return {
          selectedProvider: "openai",
          defaultModels: {
            openai: "gpt-5-2025-08-07",
            anthropic: "claude-sonnet-4-5",
            google: "gemini-2.5-pro",
            ollama: "llama3.1",
          },
          activeModel: "gpt-5-2025-08-07",
          providers: [],
          configuredProviders: [],
          isInitialized: false,
          // Functions will be added by zustand
        } as any;
      },
    },
  ),
);
