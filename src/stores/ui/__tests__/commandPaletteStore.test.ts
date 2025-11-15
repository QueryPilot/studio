import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandPaletteStore } from '../commandPaletteStore';

describe('commandPaletteStore', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({
      isOpen: false,
      query: '',
      mode: 'quickOpen',
      origin: 'quickOpen',
    });
  });

  describe('Initial State', () => {
    it('should start with palette closed', () => {
      const state = useCommandPaletteStore.getState();

      expect(state.isOpen).toBe(false);
      expect(state.query).toBe('');
      expect(state.mode).toBe('quickOpen');
      expect(state.origin).toBe('quickOpen');
    });
  });

  describe('Quick Open', () => {
    it('should open in quick open mode', () => {
      const store = useCommandPaletteStore.getState();

      store.openQuickOpen();

      const state = useCommandPaletteStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.mode).toBe('quickOpen');
      expect(state.origin).toBe('quickOpen');
      expect(state.query).toBe('');
    });

    it('should clear query when opening quick open', () => {
      const store = useCommandPaletteStore.getState();

      store.setQuery('existing query');
      store.openQuickOpen();

      expect(useCommandPaletteStore.getState().query).toBe('');
    });

    it('should reset mode to quickOpen when opening', () => {
      const store = useCommandPaletteStore.getState();

      store.openCommandPalette();
      store.openQuickOpen();

      const state = useCommandPaletteStore.getState();
      expect(state.mode).toBe('quickOpen');
      expect(state.origin).toBe('quickOpen');
    });
  });

  describe('Command Palette', () => {
    it('should open in command mode', () => {
      const store = useCommandPaletteStore.getState();

      store.openCommandPalette();

      const state = useCommandPaletteStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.mode).toBe('command');
      expect(state.origin).toBe('command');
    });

    it('should prefix query with > when opening command palette', () => {
      const store = useCommandPaletteStore.getState();

      store.openCommandPalette();

      expect(useCommandPaletteStore.getState().query).toBe('>');
    });

    it('should preserve existing > prefix in query', () => {
      const store = useCommandPaletteStore.getState();

      store.setQuery('>existing command');
      store.openCommandPalette();

      expect(useCommandPaletteStore.getState().query).toBe('>existing command');
    });

    it('should add > prefix if query does not start with >', () => {
      const store = useCommandPaletteStore.getState();

      store.setQuery('no prefix');
      store.openCommandPalette();

      expect(useCommandPaletteStore.getState().query).toBe('>');
    });
  });

  describe('Toggle Command Palette', () => {
    it('should open command palette when closed', () => {
      const store = useCommandPaletteStore.getState();

      store.toggleCommandPalette();

      const state = useCommandPaletteStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.mode).toBe('command');
      expect(state.origin).toBe('command');
    });

    it('should close when open in command mode with command origin', () => {
      const store = useCommandPaletteStore.getState();

      store.openCommandPalette();
      store.toggleCommandPalette();

      expect(useCommandPaletteStore.getState().isOpen).toBe(false);
    });

    it('should not close when open in quick open mode', () => {
      const store = useCommandPaletteStore.getState();

      store.openQuickOpen();
      store.toggleCommandPalette();

      const state = useCommandPaletteStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.mode).toBe('command');
    });

    it('should add > prefix when toggling from closed', () => {
      const store = useCommandPaletteStore.getState();

      store.toggleCommandPalette();

      expect(useCommandPaletteStore.getState().query).toBe('>');
    });

    it('should preserve > prefix when toggling', () => {
      const store = useCommandPaletteStore.getState();

      store.setQuery('>test');
      store.toggleCommandPalette();

      expect(useCommandPaletteStore.getState().query).toBe('>test');
    });
  });

  describe('Close Palette', () => {
    it('should close quick open', () => {
      const store = useCommandPaletteStore.getState();

      store.openQuickOpen();
      store.closePalette();

      expect(useCommandPaletteStore.getState().isOpen).toBe(false);
    });

    it('should close command palette', () => {
      const store = useCommandPaletteStore.getState();

      store.openCommandPalette();
      store.closePalette();

      expect(useCommandPaletteStore.getState().isOpen).toBe(false);
    });

    it('should preserve query and mode when closing', () => {
      const store = useCommandPaletteStore.getState();

      store.openCommandPalette();
      store.setQuery('>test command');
      store.closePalette();

      const state = useCommandPaletteStore.getState();
      expect(state.isOpen).toBe(false);
      expect(state.query).toBe('>test command');
      expect(state.mode).toBe('command');
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

    it('should allow query with > prefix', () => {
      const store = useCommandPaletteStore.getState();

      store.setQuery('>command');

      expect(useCommandPaletteStore.getState().query).toBe('>command');
    });

    it('should handle special characters in query', () => {
      const store = useCommandPaletteStore.getState();

      store.setQuery('test@#$%^&*()');

      expect(useCommandPaletteStore.getState().query).toBe('test@#$%^&*()');
    });
  });

  describe('Set Mode', () => {
    it('should switch to command mode', () => {
      const store = useCommandPaletteStore.getState();

      store.setMode('command');

      const state = useCommandPaletteStore.getState();
      expect(state.mode).toBe('command');
    });

    it('should switch to quickOpen mode', () => {
      const store = useCommandPaletteStore.getState();

      store.openCommandPalette();
      store.setMode('quickOpen');

      const state = useCommandPaletteStore.getState();
      expect(state.mode).toBe('quickOpen');
      expect(state.origin).toBe('quickOpen');
    });

    it('should preserve origin when switching to command mode', () => {
      const store = useCommandPaletteStore.getState();

      store.openQuickOpen();
      store.setMode('command');

      const state = useCommandPaletteStore.getState();
      expect(state.mode).toBe('command');
      expect(state.origin).toBe('quickOpen');
    });

    it('should reset origin when switching to quickOpen mode', () => {
      const store = useCommandPaletteStore.getState();

      store.openCommandPalette();
      store.setMode('quickOpen');

      const state = useCommandPaletteStore.getState();
      expect(state.mode).toBe('quickOpen');
      expect(state.origin).toBe('quickOpen');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle full quick open workflow', () => {
      const store = useCommandPaletteStore.getState();

      // Open quick open
      store.openQuickOpen();
      expect(useCommandPaletteStore.getState().isOpen).toBe(true);

      // Type query
      store.setQuery('MyComponent');
      expect(useCommandPaletteStore.getState().query).toBe('MyComponent');

      // Close
      store.closePalette();
      expect(useCommandPaletteStore.getState().isOpen).toBe(false);
    });

    it('should handle full command palette workflow', () => {
      const store = useCommandPaletteStore.getState();

      // Open command palette
      store.openCommandPalette();

      const state = useCommandPaletteStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.mode).toBe('command');
      expect(state.query).toBe('>');

      // Type command
      store.setQuery('>open settings');
      expect(useCommandPaletteStore.getState().query).toBe('>open settings');

      // Close
      store.closePalette();
      expect(useCommandPaletteStore.getState().isOpen).toBe(false);
    });

    it('should handle switching between modes', () => {
      const store = useCommandPaletteStore.getState();

      // Start with quick open
      store.openQuickOpen();
      store.setQuery('file.ts');

      // Switch to command mode
      store.setMode('command');

      let state = useCommandPaletteStore.getState();
      expect(state.mode).toBe('command');
      expect(state.query).toBe('file.ts'); // Query preserved

      // Switch back to quick open
      store.setMode('quickOpen');

      state = useCommandPaletteStore.getState();
      expect(state.mode).toBe('quickOpen');
      expect(state.origin).toBe('quickOpen');
    });

    it('should handle toggle behavior correctly', () => {
      const store = useCommandPaletteStore.getState();

      // First toggle opens
      store.toggleCommandPalette();
      expect(useCommandPaletteStore.getState().isOpen).toBe(true);

      // Second toggle closes (same origin)
      store.toggleCommandPalette();
      expect(useCommandPaletteStore.getState().isOpen).toBe(false);

      // Third toggle opens again
      store.toggleCommandPalette();
      expect(useCommandPaletteStore.getState().isOpen).toBe(true);
    });

    it('should handle opening quick open then switching to command palette', () => {
      const store = useCommandPaletteStore.getState();

      // Open quick open
      store.openQuickOpen();
      store.setQuery('component');

      // Open command palette
      store.openCommandPalette();

      const state = useCommandPaletteStore.getState();
      expect(state.isOpen).toBe(true);
      expect(state.mode).toBe('command');
      expect(state.query).toBe('>'); // Query reset with > prefix
    });
  });
});
