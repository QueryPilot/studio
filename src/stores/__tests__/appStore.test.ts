import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';

describe('appStore', () => {
  beforeEach(() => {
    // Reset to initial state
    useAppStore.setState({
      theme: 'system',
      zoomLevel: 100,
    });
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = useAppStore.getState();

      expect(state.theme).toBe('system');
      expect(state.zoomLevel).toBe(100);
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

  describe('Zoom Level', () => {
    it('should set zoom level', () => {
      const store = useAppStore.getState();

      store.setZoomLevel(110);
      expect(useAppStore.getState().zoomLevel).toBe(110);
    });

    it('should clamp zoom level to minimum 75', () => {
      const store = useAppStore.getState();

      store.setZoomLevel(50);
      expect(useAppStore.getState().zoomLevel).toBe(75);
    });

    it('should clamp zoom level to maximum 150', () => {
      const store = useAppStore.getState();

      store.setZoomLevel(200);
      expect(useAppStore.getState().zoomLevel).toBe(150);
    });

    it('should handle zoom levels at boundaries', () => {
      const store = useAppStore.getState();

      store.setZoomLevel(75);
      expect(useAppStore.getState().zoomLevel).toBe(75);

      store.setZoomLevel(150);
      expect(useAppStore.getState().zoomLevel).toBe(150);
    });

    it('should handle various zoom levels', () => {
      const store = useAppStore.getState();

      const levels = [75, 80, 90, 100, 110, 125, 150];

      for (const level of levels) {
        store.setZoomLevel(level);
        expect(useAppStore.getState().zoomLevel).toBe(level);
      }
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete app configuration', () => {
      const store = useAppStore.getState();

      store.setTheme('dark');
      store.setZoomLevel(110);

      const state = useAppStore.getState();
      expect(state.theme).toBe('dark');
      expect(state.zoomLevel).toBe(110);
    });

    it('should maintain state across multiple operations', () => {
      const store = useAppStore.getState();

      store.setTheme('dark');
      store.setZoomLevel(120);
      store.setTheme('light');

      const state = useAppStore.getState();
      expect(state.theme).toBe('light');
      expect(state.zoomLevel).toBe(120);
    });
  });

  describe('Edge Cases', () => {
    it('should preserve zoom when changing theme', () => {
      const store = useAppStore.getState();

      store.setZoomLevel(110);

      store.setTheme('dark');
      store.setTheme('light');
      store.setTheme('system');

      expect(useAppStore.getState().zoomLevel).toBe(110);
    });

    it('should preserve theme when changing zoom', () => {
      const store = useAppStore.getState();

      store.setTheme('dark');

      store.setZoomLevel(80);
      store.setZoomLevel(120);
      store.setZoomLevel(100);

      expect(useAppStore.getState().theme).toBe('dark');
    });
  });
});
