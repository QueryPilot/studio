import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PendingAppUpdate {
  version: string;
  body?: string;
}

interface AppState {
  theme: "light" | "dark" | "system";
  /** Zoom level as a percentage (75–150). Default 100. */
  zoomLevel: number;
  /** Available app update waiting to be installed */
  pendingUpdate: PendingAppUpdate | null;
  /** Whether the update is currently being installed */
  isInstallingUpdate: boolean;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setZoomLevel: (level: number) => void;
  setPendingUpdate: (update: PendingAppUpdate | null) => void;
  setIsInstallingUpdate: (installing: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: "system",
      zoomLevel: 100,
      pendingUpdate: null,
      isInstallingUpdate: false,
      setTheme: (theme) => {
        set({ theme });
      },
      setZoomLevel: (level) => {
        set({ zoomLevel: Math.min(Math.max(level, 75), 150) });
      },
      setPendingUpdate: (update) => {
        set({ pendingUpdate: update });
      },
      setIsInstallingUpdate: (installing) => {
        set({ isInstallingUpdate: installing });
      },
    }),
    {
      name: "app-store",
      partialize: (state) => ({
        theme: state.theme,
        zoomLevel: state.zoomLevel,
      }),
    },
  ),
);
