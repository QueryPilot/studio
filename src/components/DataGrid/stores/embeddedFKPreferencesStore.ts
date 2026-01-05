import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createJSONStorage } from "zustand/middleware";
import { createIndexedDbStorage } from "./indexedDbStorage";

export interface EmbeddedFKPreferences {
  embeddedColumns: Record<string, string[]>;
}

export interface EmbeddedFKPreferencesState {
  preferences: Record<string, EmbeddedFKPreferences>;

  setEmbeddedColumns: (
    key: string,
    fkColumn: string,
    refColumns: string[]
  ) => void;

  clearEmbeddedColumn: (key: string, fkColumn: string) => void;

  getEmbeddedColumns: (key: string, fkColumn: string) => string[];
}

const storage = createJSONStorage(() => createIndexedDbStorage("embedded-fk-preferences"));

export const useEmbeddedFKPreferencesStore = create<EmbeddedFKPreferencesState>()(
  devtools(
    persist(
      immer((set, get) => ({
        preferences: {},

        setEmbeddedColumns: (key, fkColumn, refColumns) => {
          set((state) => {
            if (!state.preferences[key]) {
              state.preferences[key] = { embeddedColumns: {} };
            }
            state.preferences[key].embeddedColumns[fkColumn] = refColumns;
          }, false, `embeddedFKPreferences/setEmbeddedColumns:${key}:${fkColumn}`);
        },

        clearEmbeddedColumn: (key, fkColumn) => {
          set((state) => {
            const prefs = state.preferences[key];
            if (prefs) {
              Reflect.deleteProperty(prefs.embeddedColumns, fkColumn);
            }
          }, false, `embeddedFKPreferences/clearEmbeddedColumn:${key}:${fkColumn}`);
        },

        getEmbeddedColumns: (key, fkColumn) => {
          const prefs = get().preferences[key];
          return prefs?.embeddedColumns[fkColumn] ?? [];
        },
      })),
      {
        name: "embedded-fk-preferences",
        storage,
        version: 1,
        partialize: (state) => ({ preferences: state.preferences }),
      },
    ),
  ),
);
