import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  getChatProviders,
  getSidecarStatus,
  type AIProviderConfig,
} from "@/services/aiService";

interface AIChatStoreState {
  // Provider and model selection
  selectedProvider: string | null;
  selectedModel: string | null;
  availableProviders: AIProviderConfig[];
  configuredProviders: string[]; // Providers with API keys configured on sidecar

  // Loading state
  isLoadingProviders: boolean;

  // Actions
  setProvider: (provider: string) => void;
  setModel: (model: string) => void;
  loadProviders: () => Promise<void>;
  setProviders: (providers: AIProviderConfig[]) => void;
  checkConfiguredProviders: () => Promise<void>;
}

export const useAIChatStore = create<AIChatStoreState>()(
  persist(
    (set, get) => ({
      // Initial state
      selectedProvider: null,
      selectedModel: null,
      availableProviders: [],
      configuredProviders: [],
      isLoadingProviders: false,

      // Set the selected provider
      setProvider: (provider: string) => {
        set({ selectedProvider: provider });

        // If switching providers, reset model selection
        const providers = get().availableProviders;
        const providerConfig = providers.find((p) => p.name === provider);
        if (providerConfig && providerConfig.models.length > 0) {
          // Auto-select first model of the new provider
          set({ selectedModel: providerConfig.models[0] });
        } else {
          set({ selectedModel: null });
        }
      },

      // Set the selected model
      setModel: (model: string) => {
        set({ selectedModel: model });
      },

      // Load providers from the sidecar
      loadProviders: async () => {
        // Prevent concurrent loading
        if (get().isLoadingProviders) {
          console.log("[AIChatStore] Already loading providers, skipping...");
          return;
        }

        set({ isLoadingProviders: true });
        try {
          const [providers, status] = await Promise.all([
            getChatProviders(),
            getSidecarStatus(),
          ]);

          console.log("[AIChatStore] Loaded providers:", providers);
          console.log("[AIChatStore] Sidecar status:", status);

          set({
            availableProviders: providers,
            configuredProviders: status?.configuredProviders || [],
          });

          // Auto-select first configured provider and model if none selected
          const { selectedProvider, selectedModel } = get();
          const configuredProvidersList = status?.configuredProviders || [];

          console.log("[AIChatStore] Current state:", {
            selectedProvider,
            selectedModel,
            configuredProvidersList,
          });

          if (!selectedProvider && providers.length > 0) {
            // Prefer a configured provider
            const firstConfiguredProvider = providers.find((p) =>
              configuredProvidersList.includes(p.name),
            );
            const providerToUse = firstConfiguredProvider || providers[0];

            console.log(
              "[AIChatStore] Auto-selecting provider:",
              providerToUse.name,
            );

            set({
              selectedProvider: providerToUse.name,
              selectedModel:
                providerToUse.models.length > 0
                  ? providerToUse.models[0]
                  : null,
            });
          } else if (selectedProvider && !selectedModel) {
            // If provider is selected but model isn't, select first model
            const providerConfig = providers.find(
              (p) => p.name === selectedProvider,
            );
            if (providerConfig && providerConfig.models.length > 0) {
              set({ selectedModel: providerConfig.models[0] });
            }
          }
        } catch (error) {
          console.error("[AIChatStore] Failed to load providers:", error);
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
          console.error(
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
      version: 1,
      partialize: (state) => ({
        selectedProvider: state.selectedProvider,
        selectedModel: state.selectedModel,
        // Don't persist availableProviders or configuredProviders - fetch fresh on load
      }),
    },
  ),
);

