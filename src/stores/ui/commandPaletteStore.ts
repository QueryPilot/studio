import { create } from 'zustand';

export type CommandPaletteMode = 'quickOpen' | 'command';
type CommandPaletteOrigin = 'quickOpen' | 'command';

interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  mode: CommandPaletteMode;
  origin: CommandPaletteOrigin;
  openQuickOpen: () => void;
  openCommandPalette: () => void;
  closePalette: () => void;
  toggleCommandPalette: () => void;
  setQuery: (value: string) => void;
  setMode: (mode: CommandPaletteMode) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set, get) => ({
  isOpen: false,
  query: '',
  mode: 'quickOpen',
  origin: 'quickOpen',
  openQuickOpen: () =>
    { set(() => ({
      isOpen: true,
      query: '',
      mode: 'quickOpen',
      origin: 'quickOpen',
    })); },
  openCommandPalette: () =>
    { set((state) => ({
      isOpen: true,
      mode: 'command',
      origin: 'command',
      query: state.query.startsWith('>') ? state.query : '>',
    })); },
  closePalette: () =>
    { set(() => ({
      isOpen: false,
    })); },
  toggleCommandPalette: () => {
    const state = get();
    if (state.isOpen && state.mode === 'command' && state.origin === 'command') {
      set({ isOpen: false });
      return;
    }
    set({
      isOpen: true,
      mode: 'command',
      origin: 'command',
      query: state.query.startsWith('>') ? state.query : '>',
    });
  },
  setQuery: (value: string) => { set({ query: value }); },
  setMode: (mode: CommandPaletteMode) =>
    { set((state) => ({
      mode,
      origin: mode === 'command' ? state.origin : 'quickOpen',
    })); },
}));
