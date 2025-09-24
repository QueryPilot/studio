import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AIStoreState {
  selectedModel: string;
  setSelectedModel: (model: string) => void;
}

export const useAIStore = create<AIStoreState>()(
  persist(
    (set) => ({
      selectedModel: "",
      setSelectedModel: (model: string) => set({ selectedModel: model }),
    }),
    {
      name: "ai-store",
      version: 1,
    },
  ),
);
