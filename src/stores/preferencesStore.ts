import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PreferenceCategory =
  | "general"
  | "editor"
  | "ai"
  | "shortcuts"
  | "globalShortcuts";

interface PreferencesState {
  smartQueryLimit: number | null; // null = no auto-limit, number = apply limit
  setSmartQueryLimit: (limit: number | null) => void;

  // Preferences dialog state
  isOpen: boolean;
  activeCategory: PreferenceCategory;
  openPreferences: (category?: PreferenceCategory) => void;
  closePreferences: () => void;
  setActiveCategory: (category: PreferenceCategory) => void;

  // Unsaved changes tracking
  unsavedChanges: boolean;
  setUnsavedChanges: (hasChanges: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      smartQueryLimit: 10000, // Default: 10000 rows
      setSmartQueryLimit: (limit) => {
        set({ smartQueryLimit: limit });
      },

      // Dialog state (not persisted)
      isOpen: false,
      activeCategory: "general",
      openPreferences: (category = "general") => {
        set({ isOpen: true, activeCategory: category });
      },
      closePreferences: () => {
        set({ isOpen: false, unsavedChanges: false });
      },
      setActiveCategory: (category) => {
        set({ activeCategory: category });
      },

      // Unsaved changes
      unsavedChanges: false,
      setUnsavedChanges: (hasChanges) => {
        set({ unsavedChanges: hasChanges });
      },
    }),
    {
      name: "query-pilot-preferences",
      partialize: (state) => ({
        smartQueryLimit: state.smartQueryLimit,
      }),
    },
  ),
);
