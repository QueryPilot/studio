import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  theme: "light" | "dark" | "system";
  /** Zoom level as a percentage (75–150). Default 100. */
  zoomLevel: number;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setZoomLevel: (level: number) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: "system",
      zoomLevel: 100,
      setTheme: (theme) => {
        set({ theme });
      },
      setZoomLevel: (level) => {
        set({ zoomLevel: Math.min(Math.max(level, 75), 150) });
      },
    }),
    {
      name: "app-store",
    },
  ),
);
