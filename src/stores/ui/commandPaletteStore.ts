import { create } from "zustand";

export type NestedMode =
  | { type: "switch-database" }
  | { type: "switch-schema" }
  | { type: "open-connection" }
  | { type: "switch-workspace" }
  | { type: "new-query-connection" }
  | { type: "search-saved-queries" }
  | { type: "set-safe-mode" }
  | { type: "open-erd" };

export type PaletteMode = "all" | "objects" | "actions";

interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  mode: PaletteMode;
  nestedMode: NestedMode | null;
  // Undo/redo history
  queryHistory: string[];
  historyIndex: number;
  openPalette: (options?: { query?: string; mode?: PaletteMode }) => void;
  closePalette: () => void;
  setQuery: (query: string) => void;
  setMode: (mode: PaletteMode) => void;
  setNestedMode: (mode: NestedMode | null) => void;
  exitNestedMode: () => void;
  undo: () => void;
  redo: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set, get) => ({
  isOpen: false,
  query: "",
  mode: "all",
  nestedMode: null,
  queryHistory: [""],
  historyIndex: 0,

  openPalette: (options?) => {
    const q = options?.query ?? "";
    const m = options?.mode ?? "all";
    set({ isOpen: true, query: q, mode: m, nestedMode: null, queryHistory: [q], historyIndex: 0 });
  },

  closePalette: () => {
    set({ isOpen: false, query: "", mode: "all", nestedMode: null, queryHistory: [""], historyIndex: 0 });
  },

  setQuery: (query: string) => {
    const { queryHistory, historyIndex } = get();
    if (query === queryHistory[historyIndex]) {
      return;
    }
    const newHistory = [...queryHistory.slice(0, historyIndex + 1), query];
    set({ query, queryHistory: newHistory, historyIndex: newHistory.length - 1 });
  },

  setMode: (mode: PaletteMode) => {
    set({ mode, query: "", queryHistory: [""], historyIndex: 0 });
  },

  setNestedMode: (mode: NestedMode | null) => {
    set({ nestedMode: mode, query: "", queryHistory: [""], historyIndex: 0 });
  },

  exitNestedMode: () => {
    set({ nestedMode: null, query: "", queryHistory: [""], historyIndex: 0 });
  },

  undo: () => {
    const { queryHistory, historyIndex } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      set({ query: queryHistory[newIndex], historyIndex: newIndex });
    }
  },

  redo: () => {
    const { queryHistory, historyIndex } = get();
    if (historyIndex < queryHistory.length - 1) {
      const newIndex = historyIndex + 1;
      set({ query: queryHistory[newIndex], historyIndex: newIndex });
    }
  },
}));
