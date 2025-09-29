import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AIStoreState {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  selectedAgent: string;
  setSelectedAgent: (agent: string) => void;
}

export const useAIStore = create<AIStoreState>()(
  persist(
    (set) => ({
      selectedModel: "",
      selectedAgent: "",
      setSelectedModel: (model: string) => {
        set({ selectedModel: model });
      },
      setSelectedAgent: (agent: string) => {
        set({ selectedAgent: agent });
      },
    }),
    {
      name: "ai-store",
      version: 2,
      migrate: (state, version) => {
        if (version < 2) {
          const legacy = state as { selectedModel?: string } | undefined;
          return {
            selectedModel: legacy?.selectedModel ?? "",
            selectedAgent: "",
          } as unknown as AIStoreState;
        }
        return state as AIStoreState;
      },
    },
  ),
);


