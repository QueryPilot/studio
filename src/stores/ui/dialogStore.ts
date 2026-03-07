import { create } from 'zustand';

interface DialogState {
  keyboardShortcutsOpen: boolean;
  openKeyboardShortcuts: () => void;
  closeKeyboardShortcuts: () => void;
  setKeyboardShortcutsOpen: (open: boolean) => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  keyboardShortcutsOpen: false,
  openKeyboardShortcuts: () => { set({ keyboardShortcutsOpen: true }); },
  closeKeyboardShortcuts: () => { set({ keyboardShortcutsOpen: false }); },
  setKeyboardShortcutsOpen: (open) => { set({ keyboardShortcutsOpen: open }); },
}));
