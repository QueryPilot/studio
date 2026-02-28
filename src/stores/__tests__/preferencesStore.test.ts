import { describe, it, expect, beforeEach } from 'vitest';
import { usePreferencesStore } from '../preferencesStore';

describe('preferencesStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    usePreferencesStore.setState({
      isOpen: false,
      activeCategory: 'general',
      unsavedChanges: false,
    });
  });

  describe('Preferences Dialog State', () => {
    it('should start with dialog closed', () => {
      const store = usePreferencesStore.getState();
      expect(store.isOpen).toBe(false);
    });

    it('should open preferences with default category', () => {
      const store = usePreferencesStore.getState();

      store.openPreferences();

      const newState = usePreferencesStore.getState();
      expect(newState.isOpen).toBe(true);
      expect(newState.activeCategory).toBe('general');
    });

    it('should open preferences with specific category', () => {
      const store = usePreferencesStore.getState();

      store.openPreferences('shortcuts');

      const newState = usePreferencesStore.getState();
      expect(newState.isOpen).toBe(true);
      expect(newState.activeCategory).toBe('shortcuts');
    });

    it('should close preferences and reset unsaved changes', () => {
      const store = usePreferencesStore.getState();

      // Open preferences and mark as having unsaved changes
      store.openPreferences();
      store.setUnsavedChanges(true);

      expect(usePreferencesStore.getState().isOpen).toBe(true);
      expect(usePreferencesStore.getState().unsavedChanges).toBe(true);

      // Close preferences
      store.closePreferences();

      const newState = usePreferencesStore.getState();
      expect(newState.isOpen).toBe(false);
      expect(newState.unsavedChanges).toBe(false);
    });

    it('should change active category', () => {
      const store = usePreferencesStore.getState();

      store.openPreferences('general');
      expect(usePreferencesStore.getState().activeCategory).toBe('general');

      store.setActiveCategory('ai');
      expect(usePreferencesStore.getState().activeCategory).toBe('ai');

      store.setActiveCategory('shortcuts');
      expect(usePreferencesStore.getState().activeCategory).toBe('shortcuts');
    });
  });

  describe('Unsaved Changes Tracking', () => {
    it('should start with no unsaved changes', () => {
      const store = usePreferencesStore.getState();
      expect(store.unsavedChanges).toBe(false);
    });

    it('should track unsaved changes', () => {
      const store = usePreferencesStore.getState();

      store.setUnsavedChanges(true);
      expect(usePreferencesStore.getState().unsavedChanges).toBe(true);

      store.setUnsavedChanges(false);
      expect(usePreferencesStore.getState().unsavedChanges).toBe(false);
    });

    it('should persist unsaved changes state until close', () => {
      const store = usePreferencesStore.getState();

      store.openPreferences();
      store.setUnsavedChanges(true);

      expect(usePreferencesStore.getState().unsavedChanges).toBe(true);

      // Changing category should not clear unsaved changes
      store.setActiveCategory('shortcuts');
      expect(usePreferencesStore.getState().unsavedChanges).toBe(true);

      // Only closePreferences should clear it
      store.closePreferences();
      expect(usePreferencesStore.getState().unsavedChanges).toBe(false);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle full preferences workflow', () => {
      const store = usePreferencesStore.getState();

      // 1. Open preferences
      store.openPreferences('general');
      expect(usePreferencesStore.getState().isOpen).toBe(true);
      expect(usePreferencesStore.getState().activeCategory).toBe('general');

      // 2. Make changes
      store.setUnsavedChanges(true);
      expect(usePreferencesStore.getState().unsavedChanges).toBe(true);

      // 3. Navigate to different category
      store.setActiveCategory('shortcuts');
      expect(usePreferencesStore.getState().activeCategory).toBe('shortcuts');
      expect(usePreferencesStore.getState().unsavedChanges).toBe(true); // Still has changes

      // 4. Close preferences
      store.closePreferences();
      expect(usePreferencesStore.getState().isOpen).toBe(false);
      expect(usePreferencesStore.getState().unsavedChanges).toBe(false);
    });
  });
});
