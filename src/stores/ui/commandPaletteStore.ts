import { create } from "zustand";

interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (query: string) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  query: "",

  openPalette: () => {
    set({ isOpen: true, query: "" });
  },

  closePalette: () => {
    set({ isOpen: false, query: "" });
  },

  setQuery: (query: string) => {
    set({ query });
  },
}));
