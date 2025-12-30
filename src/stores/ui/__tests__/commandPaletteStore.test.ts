import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandPaletteStore } from '../commandPaletteStore';

describe('commandPaletteStore', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({
      isOpen: false,
      query: '',
    });
  });

  describe('Initial State', () => {
    it('should start with palette closed', () => {
      const state = useCommandPaletteStore.getState();

      expect(state.isOpen).toBe(false);
      expect(state.query).toBe('');
    });
  });

  describe('Open Palette', () => {
    it('should open the palette', () => {
      const store = useCommandPaletteStore.getState();

      store.openPalette();

      const state = useCommandPaletteStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.query).toBe('');
    });

    it('should clear query when opening palette', () => {
      const store = useCommandPaletteStore.getState();

      store.setQuery('existing query');
      store.openPalette();

      expect(useCommandPaletteStore.getState().query).toBe('');
    });
  });

  describe('Close Palette', () => {
    it('should close the palette', () => {
      const store = useCommandPaletteStore.getState();

      store.openPalette();
      store.closePalette();

      expect(useCommandPaletteStore.getState().isOpen).toBe(false);
    });

    it('should clear query when closing', () => {
      const store = useCommandPaletteStore.getState();

      store.openPalette();
      store.setQuery('test query');
      store.closePalette();

      const state = useCommandPaletteStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.query).toBe('');
    });
  });

  describe('Set Query', () => {
    it('should update query', () => {
      const store = useCommandPaletteStore.getState();

      store.setQuery('test query');

      expect(useCommandPaletteStore.getState().query).toBe('test query');
    });

    it('should allow empty query', () => {
      const store = useCommandPaletteStore.getState();

      store.setQuery('something');
      store.setQuery('');

      expect(useCommandPaletteStore.getState().query).toBe('');
    });

    it('should handle special characters in query', () => {
      const store = useCommandPaletteStore.getState();

      store.setQuery('test@#$%^&*()');

      expect(useCommandPaletteStore.getState().query).toBe('test@#$%^&*()');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle full palette workflow', () => {
      const store = useCommandPaletteStore.getState();

      // Open palette
      store.openPalette();
      expect(useCommandPaletteStore.getState().isOpen).toBe(true);

      // Type query
      store.setQuery('MyComponent');
      expect(useCommandPaletteStore.getState().query).toBe('MyComponent');

      // Close
      store.closePalette();
      expect(useCommandPaletteStore.getState().isOpen).toBe(false);
      expect(useCommandPaletteStore.getState().query).toBe('');
    });

    it('should handle rapid open/close cycles', () => {
      const store = useCommandPaletteStore.getState();

      store.openPalette();
      expect(useCommandPaletteStore.getState().isOpen).toBe(true);

      store.closePalette();
      expect(useCommandPaletteStore.getState().isOpen).toBe(false);

      store.openPalette();
      expect(useCommandPaletteStore.getState().isOpen).toBe(true);

      store.closePalette();
      expect(useCommandPaletteStore.getState().isOpen).toBe(false);
    });

    it('should reset query on each open', () => {
      const store = useCommandPaletteStore.getState();

      // First use
      store.openPalette();
      store.setQuery('first search');
      store.closePalette();

      // Second use
      store.openPalette();
      expect(useCommandPaletteStore.getState().query).toBe('');
    });
  });
});
