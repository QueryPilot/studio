import { create } from "zustand";

export type NestedMode =
  | { type: "switch-database" }
  | { type: "switch-schema" }
  | { type: "open-connection" };

interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  nestedMode: NestedMode | null;
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (query: string) => void;
  setNestedMode: (mode: NestedMode | null) => void;
  exitNestedMode: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  query: "",
  nestedMode: null,

  openPalette: () => {
    set({ isOpen: true, query: "", nestedMode: null });
  },

  closePalette: () => {
    set({ isOpen: false, query: "", nestedMode: null });
  },

  setQuery: (query: string) => {
    set({ query });
  },

  setNestedMode: (mode: NestedMode | null) => {
    set({ nestedMode: mode, query: "" });
  },

  exitNestedMode: () => {
    set({ nestedMode: null, query: "" });
  },
}));
