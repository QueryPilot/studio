import { create } from 'zustand';

export interface ConfirmDialogOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'default';
}

interface DialogState {
  keyboardShortcutsOpen: boolean;
  openKeyboardShortcuts: () => void;
  closeKeyboardShortcuts: () => void;
  setKeyboardShortcutsOpen: (open: boolean) => void;

  confirmDialog: (ConfirmDialogOptions & { resolve: (confirmed: boolean) => void }) | null;
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  resolveConfirm: (confirmed: boolean) => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  keyboardShortcutsOpen: false,
  openKeyboardShortcuts: () => { set({ keyboardShortcutsOpen: true }); },
  closeKeyboardShortcuts: () => { set({ keyboardShortcutsOpen: false }); },
  setKeyboardShortcutsOpen: (open) => { set({ keyboardShortcutsOpen: open }); },

  confirmDialog: null,
  confirm: (options) => {
    // Resolve any existing dialog as cancelled before opening a new one
    const existing = get().confirmDialog;
    if (existing) {
      existing.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      set({ confirmDialog: { ...options, resolve } });
    });
  },
  resolveConfirm: (confirmed) => {
    const dialog = get().confirmDialog;
    if (dialog) {
      dialog.resolve(confirmed);
      set({ confirmDialog: null });
    }
  },
}));
