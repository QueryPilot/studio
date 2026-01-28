import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createJSONStorage } from "zustand/middleware";
import type {
  GridColumnsState,
  GridHistoryEntry,
  GridRowModel,
  GridViewState,
  SortColumn,
} from "../types";
import type { FilterMode } from "@/utils/filterParser";
import { createIndexedDbStorage } from "./indexedDbStorage";

export interface GridPreferences {
  columns: GridColumnsState;
  view: GridViewState;
  pinnedRows: string[];
  sortColumns: SortColumn[];
  historySnapshot?: {
    undoStack: GridHistoryEntry[];
    redoStack: GridHistoryEntry[];
  };
  draftRows: Record<string, GridRowModel | undefined>;
  quickFilter?: {
    value: string;
    mode: FilterMode;
  };
  /** Search query for structure view */
  structureSearch?: string;
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
  toggleColumnSort: (gridId: string, columnId: string, multiSort?: boolean) => void;
  clearSort: (gridId: string) => void;
  setHistorySnapshot: (
    gridId: string,
    snapshot: GridPreferences["historySnapshot"],
  ) => void;
  setDraftRow: (
    gridId: string,
    key: string,
    row: GridRowModel | undefined,
  ) => void;
  setQuickFilter: (
    gridId: string,
    filter: { value: string; mode: FilterMode } | undefined,
  ) => void;
  setStructureSearch: (gridId: string, search: string | undefined) => void;
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
  sortColumns: [],
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
        toggleColumnSort: (gridId, columnId, multiSort = false) => {
          set((state) => {
            const prefs =
              state.preferences[gridId] ?? createDefaultPreferences();
            if (!state.preferences[gridId]) {
              state.preferences[gridId] = prefs as any;
            }
            if (!prefs.sortColumns) {
              prefs.sortColumns = [];
            }

            const existingIndex = prefs.sortColumns.findIndex(
              (s) => s.columnId === columnId
            );

            if (existingIndex === -1) {
              // Column not sorted - add as asc
              if (multiSort) {
                prefs.sortColumns.push({ columnId, direction: 'asc' });
              } else {
                prefs.sortColumns = [{ columnId, direction: 'asc' }];
              }
            } else {
              const existing = prefs.sortColumns[existingIndex];
              if (!existing) return;
              if (existing.direction === 'asc') {
                // asc -> desc
                existing.direction = 'desc';
              } else {
                // desc -> remove
                prefs.sortColumns.splice(existingIndex, 1);
              }
            }

            prefs.updatedAt = Date.now();
          }, false, `gridPreferences/toggleColumnSort:${gridId}`);
        },
        clearSort: (gridId) => {
          set((state) => {
            const prefs =
              state.preferences[gridId] ?? createDefaultPreferences();
            if (!state.preferences[gridId]) {
              state.preferences[gridId] = prefs as any;
            }
            prefs.sortColumns = [];
            prefs.updatedAt = Date.now();
          }, false, `gridPreferences/clearSort:${gridId}`);
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
        setQuickFilter: (gridId, filter) => {
          set((state) => {
            const prefs =
              state.preferences[gridId] ?? createDefaultPreferences();
            if (!state.preferences[gridId]) {
              state.preferences[gridId] = prefs as any;
            }
            prefs.quickFilter = filter;
            prefs.updatedAt = Date.now();
          }, false, `gridPreferences/setQuickFilter:${gridId}`);
        },
        setStructureSearch: (gridId, search) => {
          set((state) => {
            const prefs =
              state.preferences[gridId] ?? createDefaultPreferences();
            if (!state.preferences[gridId]) {
              state.preferences[gridId] = prefs as any;
            }
            prefs.structureSearch = search;
            prefs.updatedAt = Date.now();
          }, false, `gridPreferences/setStructureSearch:${gridId}`);
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
