import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AIStoreState {
  // Sidecar connection state
  sidecarConnected: boolean;
  setSidecarConnected: (connected: boolean) => void;

  sidecarUrl: string | null;
  setSidecarUrl: (url: string | null) => void;
}

export const useAIStore = create<AIStoreState>()(
  persist(
    (set) => ({
      sidecarConnected: false,
      setSidecarConnected: (connected: boolean) => {
        set({ sidecarConnected: connected });
      },

      sidecarUrl: null,
      setSidecarUrl: (url: string | null) => {
        set({ sidecarUrl: url });
      },
    }),
    {
      name: "ai-store",
      version: 5,
    },
  ),
);
