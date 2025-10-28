import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PreferencesState {
  smartQueryLimit: number | null; // null = no auto-limit, number = apply limit
  setSmartQueryLimit: (limit: number | null) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      smartQueryLimit: 10000, // Default: 10000 rows
      setSmartQueryLimit: (limit) => { set({ smartQueryLimit: limit }); },
    }),
    {
      name: "query-pilot-preferences",
    },
  ),
);
