import { logger } from "@/lib/logger";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  getChatProviders,
  getSidecarStatus,
  type AIProviderConfig,
} from "@/services/aiService";

interface AIChatStoreState {
  // Sidecar connection state
  sidecarConnected: boolean;
  sidecarUrl: string | null;

  // Provider and model selection
  selectedProvider: string | null;
  selectedModel: string | null;
  availableProviders: AIProviderConfig[];
  configuredProviders: string[]; // Providers with API keys configured on sidecar

  // Per-provider default models
  providerDefaultModels: Record<string, string>; // { provider: modelName }

  // Per-provider enabled models (for multi-select)
  providerEnabledModels: Record<string, string[]>; // { provider: [modelNames] }

  // Loading state
  isLoadingProviders: boolean;

  // Sidecar actions
  setSidecarConnected: (connected: boolean) => void;
  setSidecarUrl: (url: string | null) => void;

  // Provider/model actions
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  setProviderDefaultModel: (provider: string, model: string) => void;
  getProviderDefaultModel: (provider: string) => string | null;
  toggleProviderModel: (provider: string, model: string) => void;
  getProviderEnabledModels: (provider: string) => string[];
  loadProviders: () => Promise<void>;
  setProviders: (providers: AIProviderConfig[]) => void;
  checkConfiguredProviders: () => Promise<void>;
}

export const useAIChatStore = create<AIChatStoreState>()(
  persist(
    (set, get) => ({
      // Initial state - Sidecar connection
      sidecarConnected: false,
      sidecarUrl: null,

      // Initial state - Provider/model selection
      selectedProvider: null,
      selectedModel: null,
      availableProviders: [],
      configuredProviders: [],
      providerDefaultModels: {},
      providerEnabledModels: {},
      isLoadingProviders: false,

      // Sidecar connection actions
      setSidecarConnected: (connected: boolean) => {
        set({ sidecarConnected: connected });
      },
      setSidecarUrl: (url: string | null) => {
        set({ sidecarUrl: url });
      },

      // Set the selected provider
      setProvider: (provider: string) => {
        set({ selectedProvider: provider });

        // If switching providers, reset model selection
        const providers = get().availableProviders;
        const providerConfig = providers.find((p) => p.name === provider);
        if (providerConfig && providerConfig.models.length > 0) {
          // Auto-select first model of the new provider
          set({ selectedModel: providerConfig.models[0]?.id ?? null });
        } else {
          set({ selectedModel: null });
        }
      },

      // Set the selected model
      setModel: (model: string) => {
        set({ selectedModel: model });
      },

      // Set default model for a provider
      setProviderDefaultModel: (provider: string, model: string) => {
        set((state) => ({
          providerDefaultModels: {
            ...state.providerDefaultModels,
            [provider]: model,
          },
        }));
      },

      // Get default model for a provider
      getProviderDefaultModel: (provider: string) => {
        return get().providerDefaultModels[provider] || null;
      },

      // Toggle model enabled/disabled for a provider
      toggleProviderModel: (provider: string, model: string) => {
        set((state) => {
          const currentEnabled = state.providerEnabledModels[provider] || [];
          const isEnabled = currentEnabled.includes(model);

          let newEnabled: string[];
          if (isEnabled) {
            // Remove model
            newEnabled = currentEnabled.filter((m) => m !== model);

            // If this was the default model, clear it
            if (state.providerDefaultModels[provider] === model) {
              const newDefaults = { ...state.providerDefaultModels };
              delete newDefaults[provider];
              return {
                providerEnabledModels: {
                  ...state.providerEnabledModels,
                  [provider]: newEnabled,
                },
                providerDefaultModels: newDefaults,
              };
            }
          } else {
            // Add model
            newEnabled = [...currentEnabled, model];
          }

          return {
            providerEnabledModels: {
              ...state.providerEnabledModels,
              [provider]: newEnabled,
            },
          };
        });
      },

      // Get enabled models for a provider
      getProviderEnabledModels: (provider: string) => {
        return get().providerEnabledModels[provider] || [];
      },

      // Load providers from the sidecar
      loadProviders: async () => {
        // Prevent concurrent loading
        if (get().isLoadingProviders) {
          logger.info("[AIChatStore] Already loading providers, skipping...");
          return;
        }

        set({ isLoadingProviders: true });
        try {
          const [providers, status] = await Promise.all([
            getChatProviders(),
            getSidecarStatus(),
          ]);

          logger.info("[AIChatStore] Loaded providers:", providers);
          logger.info("[AIChatStore] Sidecar status:", status);

          set({
            availableProviders: providers,
            configuredProviders: status?.configuredProviders || [],
          });

          // Auto-select first configured provider and model if none selected
          const { selectedProvider, selectedModel } = get();
          const configuredProvidersList = status?.configuredProviders || [];

          logger.info("[AIChatStore] Current state:", {
            selectedProvider,
            selectedModel,
            configuredProvidersList,
          });

          if (!selectedProvider && providers.length > 0) {
            // Prefer a configured provider
            const firstConfiguredProvider = providers.find((p) =>
              configuredProvidersList.includes(p.name),
            );
            const providerToUse = firstConfiguredProvider ?? providers[0];

            if (providerToUse) {
              logger.info(
                "[AIChatStore] Auto-selecting provider:",
                providerToUse.name,
              );

              set({
                selectedProvider: providerToUse.name,
                selectedModel:
                  providerToUse.models.length > 0
                    ? providerToUse.models[0]?.id ?? null
                    : null,
              });
            }
          } else if (selectedProvider && !selectedModel) {
            // If provider is selected but model isn't, select first model
            const providerConfig = providers.find(
              (p) => p.name === selectedProvider,
            );
            if (providerConfig && providerConfig.models.length > 0) {
              set({ selectedModel: providerConfig.models[0]?.id ?? null });
            }
          }
        } catch (error) {
          logger.error("[AIChatStore] Failed to load providers:", error);
        } finally {
          set({ isLoadingProviders: false });
        }
      },

      // Check which providers have API keys configured
      checkConfiguredProviders: async () => {
        try {
          const status = await getSidecarStatus();
          if (status) {
            set({ configuredProviders: status.configuredProviders });
          }
        } catch (error) {
          logger.error(
            "[AIChatStore] Failed to check configured providers:",
            error,
          );
        }
      },

      // Set providers directly (for testing or manual updates)
      setProviders: (providers: AIProviderConfig[]) => {
        set({ availableProviders: providers });
      },
    }),
    {
      name: "ai-chat-store",
      version: 3,
      partialize: (state) => ({
        selectedProvider: state.selectedProvider,
        selectedModel: state.selectedModel,
        providerDefaultModels: state.providerDefaultModels,
        providerEnabledModels: state.providerEnabledModels,
        // Don't persist availableProviders or configuredProviders - fetch fresh on load
      }),
    },
  ),
);

