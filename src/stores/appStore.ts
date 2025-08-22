import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  theme: "light" | "dark" | "system";
  sidebarCollapsed: boolean;
  recentConnections: string[];
  preferences: {
    autoSave: boolean;
    fontSize: number;
    tabSize: number;
  };
  setTheme: (theme: "light" | "dark" | "system") => void;
  toggleSidebar: () => void;
  addRecentConnection: (connectionId: string) => void;
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
      setTheme: (theme) => { set({ theme }); },
      toggleSidebar: () =>
        { set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })); },
      addRecentConnection: (connectionId) =>
        { set((state) => ({
          recentConnections: [
            connectionId,
            ...state.recentConnections.filter((id) => id !== connectionId),
          ].slice(0, 10),
        })); },
      updatePreferences: (preferences) =>
        { set((state) => ({
          preferences: { ...state.preferences, ...preferences },
        })); },
    }),
    {
      name: "app-store",
    }
  )
);