import { describe, it, expect, beforeEach } from 'vitest';
import { useDialogStore } from '../dialogStore';

describe('dialogStore', () => {
  beforeEach(() => {
    useDialogStore.setState({
      preferencesOpen: false,
      keyboardShortcutsOpen: false,
    });
  });

  describe('Initial State', () => {
    it('should start with all dialogs closed', () => {
      const state = useDialogStore.getState();

      expect(state.preferencesOpen).toBe(false);
      expect(state.keyboardShortcutsOpen).toBe(false);
    });
  });

  describe('Preferences Dialog', () => {
    it('should open preferences dialog', () => {
      const store = useDialogStore.getState();

      store.openPreferences();

      expect(useDialogStore.getState().preferencesOpen).toBe(true);
    });

    it('should close preferences dialog', () => {
      const store = useDialogStore.getState();

      store.openPreferences();
      store.closePreferences();

      expect(useDialogStore.getState().preferencesOpen).toBe(false);
    });

    it('should set preferences dialog state directly', () => {
      const store = useDialogStore.getState();

      store.setPreferencesOpen(true);
      expect(useDialogStore.getState().preferencesOpen).toBe(true);

      store.setPreferencesOpen(false);
      expect(useDialogStore.getState().preferencesOpen).toBe(false);
    });

    it('should not affect keyboard shortcuts dialog when opening preferences', () => {
      const store = useDialogStore.getState();

      store.setKeyboardShortcutsOpen(true);
      store.openPreferences();

      const state = useDialogStore.getState();
      expect(state.preferencesOpen).toBe(true);
      expect(state.keyboardShortcutsOpen).toBe(true);
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

    it('should not affect preferences dialog when opening keyboard shortcuts', () => {
      const store = useDialogStore.getState();

      store.setPreferencesOpen(true);
      store.openKeyboardShortcuts();

      const state = useDialogStore.getState();
      expect(state.preferencesOpen).toBe(true);
      expect(state.keyboardShortcutsOpen).toBe(true);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle opening and closing multiple dialogs', () => {
      const store = useDialogStore.getState();

      // Open both
      store.openPreferences();
      store.openKeyboardShortcuts();

      let state = useDialogStore.getState();
      expect(state.preferencesOpen).toBe(true);
      expect(state.keyboardShortcutsOpen).toBe(true);

      // Close preferences
      store.closePreferences();

      state = useDialogStore.getState();
      expect(state.preferencesOpen).toBe(false);
      expect(state.keyboardShortcutsOpen).toBe(true);

      // Close keyboard shortcuts
      store.closeKeyboardShortcuts();

      state = useDialogStore.getState();
      expect(state.preferencesOpen).toBe(false);
      expect(state.keyboardShortcutsOpen).toBe(false);
    });

    it('should handle rapid open/close operations', () => {
      const store = useDialogStore.getState();

      for (let i = 0; i < 10; i++) {
        store.openPreferences();
        store.closePreferences();
      }

      expect(useDialogStore.getState().preferencesOpen).toBe(false);
    });
  });
});
