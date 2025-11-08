import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';

describe('appStore', () => {
  beforeEach(() => {
    // Reset to initial state
    useAppStore.setState({
      theme: 'system',
      sidebarCollapsed: false,
      preferences: {
        autoSave: true,
        fontSize: 14,
        tabSize: 2,
      },
    });
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = useAppStore.getState();

      expect(state.theme).toBe('system');
      expect(state.sidebarCollapsed).toBe(false);
      expect(state.preferences).toEqual({
        autoSave: true,
        fontSize: 14,
        tabSize: 2,
      });
    });
  });

  describe('Theme Management', () => {
    it('should set theme to light', () => {
      const store = useAppStore.getState();

      store.setTheme('light');
      expect(useAppStore.getState().theme).toBe('light');
    });

    it('should set theme to dark', () => {
      const store = useAppStore.getState();

      store.setTheme('dark');
      expect(useAppStore.getState().theme).toBe('dark');
    });

    it('should set theme to system', () => {
      const store = useAppStore.getState();

      store.setTheme('system');
      expect(useAppStore.getState().theme).toBe('system');
    });

    it('should toggle between themes', () => {
      const store = useAppStore.getState();

      store.setTheme('light');
      expect(useAppStore.getState().theme).toBe('light');

      store.setTheme('dark');
      expect(useAppStore.getState().theme).toBe('dark');

      store.setTheme('system');
      expect(useAppStore.getState().theme).toBe('system');
    });
  });

  describe('Sidebar Management', () => {
    it('should toggle sidebar from expanded to collapsed', () => {
      const store = useAppStore.getState();

      expect(useAppStore.getState().sidebarCollapsed).toBe(false);

      store.toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    });

    it('should toggle sidebar from collapsed to expanded', () => {
      useAppStore.setState({ sidebarCollapsed: true });

      const store = useAppStore.getState();
      store.toggleSidebar();

      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });

    it('should toggle sidebar multiple times', () => {
      const store = useAppStore.getState();

      store.toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);

      store.toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);

      store.toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    });
  });

  describe('Preferences Management', () => {
    it('should update autoSave preference', () => {
      const store = useAppStore.getState();

      store.updatePreferences({ autoSave: false });

      const state = useAppStore.getState();
      expect(state.preferences.autoSave).toBe(false);
      expect(state.preferences.fontSize).toBe(14); // Unchanged
      expect(state.preferences.tabSize).toBe(2); // Unchanged
    });

    it('should update fontSize preference', () => {
      const store = useAppStore.getState();

      store.updatePreferences({ fontSize: 16 });

      const state = useAppStore.getState();
      expect(state.preferences.fontSize).toBe(16);
      expect(state.preferences.autoSave).toBe(true); // Unchanged
      expect(state.preferences.tabSize).toBe(2); // Unchanged
    });

    it('should update tabSize preference', () => {
      const store = useAppStore.getState();

      store.updatePreferences({ tabSize: 4 });

      const state = useAppStore.getState();
      expect(state.preferences.tabSize).toBe(4);
      expect(state.preferences.autoSave).toBe(true); // Unchanged
      expect(state.preferences.fontSize).toBe(14); // Unchanged
    });

    it('should update multiple preferences at once', () => {
      const store = useAppStore.getState();

      store.updatePreferences({
        autoSave: false,
        fontSize: 18,
        tabSize: 4,
      });

      const state = useAppStore.getState();
      expect(state.preferences).toEqual({
        autoSave: false,
        fontSize: 18,
        tabSize: 4,
      });
    });

    it('should update partial preferences', () => {
      const store = useAppStore.getState();

      store.updatePreferences({
        fontSize: 16,
        tabSize: 4,
      });

      const state = useAppStore.getState();
      expect(state.preferences.autoSave).toBe(true); // Unchanged
      expect(state.preferences.fontSize).toBe(16);
      expect(state.preferences.tabSize).toBe(4);
    });

    it('should handle preference updates sequentially', () => {
      const store = useAppStore.getState();

      store.updatePreferences({ fontSize: 16 });
      expect(useAppStore.getState().preferences.fontSize).toBe(16);

      store.updatePreferences({ tabSize: 4 });
      expect(useAppStore.getState().preferences.fontSize).toBe(16); // Still 16
      expect(useAppStore.getState().preferences.tabSize).toBe(4);
    });
  });

  describe('Font Size Ranges', () => {
    it('should handle minimum font size', () => {
      const store = useAppStore.getState();

      store.updatePreferences({ fontSize: 10 });
      expect(useAppStore.getState().preferences.fontSize).toBe(10);
    });

    it('should handle maximum font size', () => {
      const store = useAppStore.getState();

      store.updatePreferences({ fontSize: 24 });
      expect(useAppStore.getState().preferences.fontSize).toBe(24);
    });

    it('should handle various font sizes', () => {
      const store = useAppStore.getState();

      const sizes = [12, 14, 16, 18, 20];

      sizes.forEach((size) => {
        store.updatePreferences({ fontSize: size });
        expect(useAppStore.getState().preferences.fontSize).toBe(size);
      });
    });
  });

  describe('Tab Size Options', () => {
    it('should handle 2-space tabs', () => {
      const store = useAppStore.getState();

      store.updatePreferences({ tabSize: 2 });
      expect(useAppStore.getState().preferences.tabSize).toBe(2);
    });

    it('should handle 4-space tabs', () => {
      const store = useAppStore.getState();

      store.updatePreferences({ tabSize: 4 });
      expect(useAppStore.getState().preferences.tabSize).toBe(4);
    });

    it('should handle 8-space tabs', () => {
      const store = useAppStore.getState();

      store.updatePreferences({ tabSize: 8 });
      expect(useAppStore.getState().preferences.tabSize).toBe(8);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete app configuration', () => {
      const store = useAppStore.getState();

      // User sets dark theme
      store.setTheme('dark');

      // User collapses sidebar
      store.toggleSidebar();

      // User updates preferences
      store.updatePreferences({
        autoSave: false,
        fontSize: 16,
        tabSize: 4,
      });

      const state = useAppStore.getState();
      expect(state.theme).toBe('dark');
      expect(state.sidebarCollapsed).toBe(true);
      expect(state.preferences).toEqual({
        autoSave: false,
        fontSize: 16,
        tabSize: 4,
      });
    });

    it('should maintain state across multiple operations', () => {
      const store = useAppStore.getState();

      store.setTheme('dark');
      store.updatePreferences({ fontSize: 16 });
      store.toggleSidebar();
      store.updatePreferences({ tabSize: 4 });
      store.setTheme('light');

      const state = useAppStore.getState();
      expect(state.theme).toBe('light');
      expect(state.sidebarCollapsed).toBe(true);
      expect(state.preferences.fontSize).toBe(16);
      expect(state.preferences.tabSize).toBe(4);
    });
  });

  describe('Edge Cases', () => {
    it('should handle toggling sidebar many times', () => {
      const store = useAppStore.getState();

      for (let i = 0; i < 10; i++) {
        store.toggleSidebar();
      }

      // Should be collapsed after 10 toggles (even number)
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });

    it('should handle empty preference updates', () => {
      const store = useAppStore.getState();
      const initialPrefs = { ...useAppStore.getState().preferences };

      store.updatePreferences({});

      expect(useAppStore.getState().preferences).toEqual(initialPrefs);
    });

    it('should preserve preferences when changing theme', () => {
      const store = useAppStore.getState();

      store.updatePreferences({
        autoSave: false,
        fontSize: 18,
        tabSize: 4,
      });

      store.setTheme('dark');
      store.setTheme('light');
      store.setTheme('system');

      expect(useAppStore.getState().preferences).toEqual({
        autoSave: false,
        fontSize: 18,
        tabSize: 4,
      });
    });

    it('should preserve theme when toggling sidebar', () => {
      const store = useAppStore.getState();

      store.setTheme('dark');

      store.toggleSidebar();
      store.toggleSidebar();
      store.toggleSidebar();

      expect(useAppStore.getState().theme).toBe('dark');
    });
  });
});
