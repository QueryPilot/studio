import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  theme: "light" | "dark" | "system";
  sidebarCollapsed: boolean;
  preferences: {
    autoSave: boolean;
    fontSize: number;
    tabSize: number;
  };
  setTheme: (theme: "light" | "dark" | "system") => void;
  toggleSidebar: () => void;
  updatePreferences: (preferences: Partial<AppState["preferences"]>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: "system",
      sidebarCollapsed: false,
      recentConnections: [],
      preferences: {
        autoSave: true,
        fontSize: 14,
        tabSize: 2,
      },
      setTheme: (theme) => {
        set({ theme });
      },
      toggleSidebar: () => {
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
      },
      updatePreferences: (preferences) => {
        set((state) => ({
          preferences: { ...state.preferences, ...preferences },
        }));
      },
    }),
    {
      name: "app-store",
    },
  ),
);
