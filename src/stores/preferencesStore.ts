import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PreferenceCategory = "general" | "editor" | "ai" | "shortcuts";

export interface AIRuntime {
  id: "opencode" | "openai-codex";
  name: string;
  providers: AIProvider[];
}

export interface AIProvider {
  id: string;
  name: string;
  authType: "api-key" | "oauth";
  configured: boolean;
  config?: {
    apiKey?: string;
    oauthToken?: string;
    expiresAt?: Date;
    accountInfo?: {
      email?: string;
      username?: string;
    };
  };
}

interface PreferencesState {
  isOpen: boolean;
  activeCategory: PreferenceCategory;
  unsavedChanges: boolean;

  // AI Runtime settings
  selectedRuntime: "opencode" | "openai-codex";
  aiProviders: Record<string, AIProvider[]>;

  // Actions
  open: () => void;
  close: () => void;
  setActiveCategory: (category: PreferenceCategory) => void;
  setUnsavedChanges: (hasChanges: boolean) => void;
  setSelectedRuntime: (runtime: "opencode" | "openai-codex") => void;
  updateProvider: (
    runtimeId: string,
    providerId: string,
    config: Partial<AIProvider>,
  ) => void;
  saveProviderApiKey: (
    runtimeId: string,
    providerId: string,
    apiKey: string,
  ) => void;
  clearProviderAuth: (runtimeId: string, providerId: string) => void;
}

const defaultProviders = {
  opencode: [
    {
      id: "anthropic",
      name: "Anthropic",
      authType: "api-key" as const,
      configured: false,
    },
    {
      id: "github-copilot",
      name: "GitHub Copilot",
      authType: "oauth" as const,
      configured: false,
    },
    {
      id: "openai",
      name: "OpenAI",
      authType: "api-key" as const,
      configured: false,
    },
  ],
  "openai-codex": [
    {
      id: "anthropic-codex",
      name: "Anthropic",
      authType: "api-key" as const,
      configured: false,
    },
    {
      id: "github-copilot-codex",
      name: "GitHub Copilot",
      authType: "oauth" as const,
      configured: false,
    },
    {
      id: "openai-codex",
      name: "OpenAI",
      authType: "api-key" as const,
      configured: false,
    },
  ],
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      isOpen: false,
      activeCategory: "general",
      unsavedChanges: false,
      selectedRuntime: "opencode",
      aiProviders: defaultProviders,

      open: () => {
        set({ isOpen: true });
      },
      close: () => {
        set({ isOpen: false, unsavedChanges: false });
      },

      setActiveCategory: (category) => {
        set({ activeCategory: category });
      },
      setUnsavedChanges: (hasChanges) => {
        set({ unsavedChanges: hasChanges });
      },
      setSelectedRuntime: (runtime) => {
        set({ selectedRuntime: runtime });
      },

      updateProvider: (runtimeId, providerId, config) => {
        set((state) => ({
          aiProviders: {
            ...state.aiProviders,
            [runtimeId]:
              state.aiProviders[runtimeId]?.map((p) =>
                p.id === providerId ? { ...p, ...config } : p,
              ) || [],
          },
        }));
      },

      saveProviderApiKey: (runtimeId, providerId, apiKey) => {
        set((state) => ({
          aiProviders: {
            ...state.aiProviders,
            [runtimeId]:
              state.aiProviders[runtimeId]?.map((p) =>
                p.id === providerId
                  ? {
                      ...p,
                      configured: true,
                      config: { ...p.config, apiKey },
                    }
                  : p,
              ) || [],
          },
        }));
      },

      clearProviderAuth: (runtimeId, providerId) => {
        set((state) => ({
          aiProviders: {
            ...state.aiProviders,
            [runtimeId]:
              state.aiProviders[runtimeId]?.map((p) =>
                p.id === providerId
                  ? {
                      ...p,
                      configured: false,
                      config: undefined,
                    }
                  : p,
              ) || [],
          },
        }));
      },
    }),
    {
      name: "preferences-store",
      partialize: (state) => ({
        selectedRuntime: state.selectedRuntime,
        aiProviders: state.aiProviders,
      }),
    },
  ),
);
