import { create } from 'zustand';

interface DialogState {
  preferencesOpen: boolean;
  keyboardShortcutsOpen: boolean;
  openPreferences: () => void;
  closePreferences: () => void;
  setPreferencesOpen: (open: boolean) => void;
  openKeyboardShortcuts: () => void;
  closeKeyboardShortcuts: () => void;
  setKeyboardShortcutsOpen: (open: boolean) => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  preferencesOpen: false,
  keyboardShortcutsOpen: false,
  openPreferences: () => { set({ preferencesOpen: true }); },
  closePreferences: () => { set({ preferencesOpen: false }); },
  setPreferencesOpen: (open) => { set({ preferencesOpen: open }); },
  openKeyboardShortcuts: () => { set({ keyboardShortcutsOpen: true }); },
  closeKeyboardShortcuts: () => { set({ keyboardShortcutsOpen: false }); },
  setKeyboardShortcutsOpen: (open) => { set({ keyboardShortcutsOpen: open }); },
}));
