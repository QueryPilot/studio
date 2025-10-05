import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PreferenceCategory = "general" | "editor" | "shortcuts" | "globalShortcuts" | "ai";

interface PreferencesState {
  isOpen: boolean;
  activeCategory: PreferenceCategory;
  unsavedChanges: boolean;

  // Actions
  open: () => void;
  close: () => void;
  setActiveCategory: (category: PreferenceCategory) => void;
  setUnsavedChanges: (hasChanges: boolean) => void;
}


export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      isOpen: false,
      activeCategory: "general",
      unsavedChanges: false,

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
    }),
    {
      name: "preferences-store",
    },
  ),
);
