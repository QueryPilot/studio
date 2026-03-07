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

interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  nestedMode: NestedMode | null;
  // Undo/redo history
  queryHistory: string[];
  historyIndex: number;
  openPalette: (initialQuery?: string) => void;
  closePalette: () => void;
  setQuery: (query: string) => void;
  setNestedMode: (mode: NestedMode | null) => void;
  exitNestedMode: () => void;
  undo: () => void;
  redo: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set, get) => ({
  isOpen: false,
  query: "",
  nestedMode: null,
  queryHistory: [""],
  historyIndex: 0,

  openPalette: (initialQuery?: string) => {
    const q = initialQuery ?? "";
    set({ isOpen: true, query: q, nestedMode: null, queryHistory: [q], historyIndex: 0 });
  },

  closePalette: () => {
    set({ isOpen: false, query: "", nestedMode: null, queryHistory: [""], historyIndex: 0 });
  },

  setQuery: (query: string) => {
    const { queryHistory, historyIndex } = get();
    // Only add to history if different from current
    if (query === queryHistory[historyIndex]) {
      return;
    }
    // Truncate future history and add new entry
    const newHistory = [...queryHistory.slice(0, historyIndex + 1), query];
    set({ query, queryHistory: newHistory, historyIndex: newHistory.length - 1 });
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
