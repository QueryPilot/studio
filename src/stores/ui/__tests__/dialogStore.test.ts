import { describe, it, expect, beforeEach } from 'vitest';
import { useDialogStore } from '../dialogStore';

describe('dialogStore', () => {
  beforeEach(() => {
    useDialogStore.setState({
      keyboardShortcutsOpen: false,
    });
  });

  describe('Initial State', () => {
    it('should start with all dialogs closed', () => {
      const state = useDialogStore.getState();

      expect(state.keyboardShortcutsOpen).toBe(false);
    });
  });

  describe('Keyboard Shortcuts Dialog', () => {
    it('should open keyboard shortcuts dialog', () => {
      const store = useDialogStore.getState();

      store.openKeyboardShortcuts();

      expect(useDialogStore.getState().keyboardShortcutsOpen).toBe(true);
    });

    it('should close keyboard shortcuts dialog', () => {
      const store = useDialogStore.getState();

      store.openKeyboardShortcuts();
      store.closeKeyboardShortcuts();

      expect(useDialogStore.getState().keyboardShortcutsOpen).toBe(false);
    });

    it('should set keyboard shortcuts dialog state directly', () => {
      const store = useDialogStore.getState();

      store.setKeyboardShortcutsOpen(true);
      expect(useDialogStore.getState().keyboardShortcutsOpen).toBe(true);

      store.setKeyboardShortcutsOpen(false);
      expect(useDialogStore.getState().keyboardShortcutsOpen).toBe(false);
    });
  });
});
