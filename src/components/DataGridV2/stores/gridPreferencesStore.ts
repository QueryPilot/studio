import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createJSONStorage } from "zustand/middleware";
import type {
  GridColumnsState,
  GridHistoryEntry,
  GridRowModel,
  GridViewState,
} from "../types";
import { createIndexedDbStorage } from "./indexedDbStorage";

export interface GridPreferences {
  columns: GridColumnsState;
  view: GridViewState;
  pinnedRows: string[];
  historySnapshot?: {
    undoStack: GridHistoryEntry[];
    redoStack: GridHistoryEntry[];
  };
  draftRows: Record<string, GridRowModel | undefined>;
  createdAt: number;
  updatedAt: number;
}

export interface GridPreferencesState {
  preferences: Record<string, GridPreferences>;
  upsert: (gridId: string, updater: (draft: GridPreferences) => void) => void;
  updateColumns: (gridId: string, updater: (draft: GridColumnsState) => void) => void;
  updateView: (gridId: string, updater: (draft: GridViewState) => void) => void;
  updatePinnedRows: (
    gridId: string,
    updater: (draft: string[]) => string[] | undefined,
  ) => void;
  setHistorySnapshot: (
    gridId: string,
    snapshot: GridPreferences["historySnapshot"],
  ) => void;
  setDraftRow: (
    gridId: string,
    key: string,
    row: GridRowModel | undefined,
  ) => void;
  reset: (gridId: string) => void;
  resetAll: () => void;
}

const createDefaultColumnsState = (): GridColumnsState => ({
  order: [],
  widths: {},
  visibility: {},
  pinned: [],
});

const createDefaultViewState = (): GridViewState => ({
  selection: undefined,
  activeCell: null,
  scrollOffset: { x: 0, y: 0 },
  pinnedColumns: [],
  pinnedRows: [],
});

const createDefaultPreferences = (): GridPreferences => ({
  columns: createDefaultColumnsState(),
  view: createDefaultViewState(),
  pinnedRows: [],
  draftRows: {},
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const storage = createJSONStorage(() => createIndexedDbStorage("grid-preferences"));

export const useGridPreferencesStore = create<GridPreferencesState>()(
  devtools(
    persist(
      immer((set) => ({
        preferences: {},
        upsert: (gridId, updater) => {
          set((state) => {
            const prefs =
              state.preferences[gridId] ?? createDefaultPreferences();
            if (!state.preferences[gridId]) {
              state.preferences[gridId] = prefs as any;
            }
            updater(prefs);
            prefs.updatedAt = Date.now();
          }, false, `gridPreferences/upsert:${gridId}`);
        },
        updateColumns: (gridId, updater) => {
          set((state) => {
            const prefs =
              state.preferences[gridId] ?? createDefaultPreferences();
            if (!state.preferences[gridId]) {
              state.preferences[gridId] = prefs as any;
            }
            updater(prefs.columns);
            prefs.updatedAt = Date.now();
          }, false, `gridPreferences/updateColumns:${gridId}`);
        },
        updateView: (gridId, updater) => {
          set((state) => {
            const prefs =
              state.preferences[gridId] ?? createDefaultPreferences();
            if (!state.preferences[gridId]) {
              state.preferences[gridId] = prefs as any;
            }
            updater(prefs.view);
            prefs.updatedAt = Date.now();
          }, false, `gridPreferences/updateView:${gridId}`);
        },
        updatePinnedRows: (gridId, updater) => {
          set((state) => {
            const prefs =
              state.preferences[gridId] ?? createDefaultPreferences();
            if (!state.preferences[gridId]) {
              state.preferences[gridId] = prefs as any;
            }
            const workingCopy = [...prefs.pinnedRows];
            const result = updater(workingCopy);
            prefs.pinnedRows = Array.isArray(result) ? result : workingCopy;
            prefs.updatedAt = Date.now();
          }, false, `gridPreferences/updatePinnedRows:${gridId}`);
        },
        setHistorySnapshot: (gridId, snapshot) => {
          set((state) => {
            const prefs =
              state.preferences[gridId] ?? createDefaultPreferences();
            if (!state.preferences[gridId]) {
              state.preferences[gridId] = prefs as any;
            }
            prefs.historySnapshot = snapshot
              ? {
                  undoStack: [...snapshot.undoStack],
                  redoStack: [...snapshot.redoStack],
                }
              : undefined;
            prefs.updatedAt = Date.now();
          }, false, `gridPreferences/upsert:${gridId}`);
        },
        setDraftRow: (gridId, key, row) => {
          set((state) => {
            const prefs =
              state.preferences[gridId] ?? createDefaultPreferences();
            if (!state.preferences[gridId]) {
              state.preferences[gridId] = prefs as any;
            }
            if (!prefs.draftRows) {
              prefs.draftRows = {};
            }
            if (row) {
              prefs.draftRows[key] = row;
            } else {
              Reflect.deleteProperty(prefs.draftRows, key);
            }
            prefs.updatedAt = Date.now();
          }, false, `gridPreferences/setDraftRow:${gridId}`);
        },
        reset: (gridId) => {
          set((state) => {
            Reflect.deleteProperty(state.preferences, gridId);
          }, false, `gridPreferences/reset:${gridId}`);
        },
        resetAll: () => {
          set({ preferences: {} }, false, "gridPreferences/resetAll");
        },
      })),
      {
        name: "grid-preferences",
        storage,
        version: 1,
        partialize: (state) => ({ preferences: state.preferences }),
      },
    ),
  ),
);
