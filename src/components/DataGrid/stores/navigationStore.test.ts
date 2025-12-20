import { describe, it, expect, beforeEach } from 'vitest';
import { useNavigationStore } from './navigationStore';

describe('navigationStore', () => {
  beforeEach(() => {
    useNavigationStore.getState().reset();
  });

  describe('selectCell', () => {
    it('transitions from browsing to selected', () => {
      const { selectCell, getMode, getSelectedCell } = useNavigationStore.getState();
      selectCell([0, 1]);
      expect(getMode()).toBe('selected');
      expect(getSelectedCell()).toEqual([0, 1]);
    });

    it('updates selected cell when already in selected mode', () => {
      const { selectCell, getSelectedCell } = useNavigationStore.getState();
      selectCell([0, 1]);
      selectCell([2, 3]);
      expect(getSelectedCell()).toEqual([2, 3]);
    });
  });

  describe('enterEdit', () => {
    it('transitions from selected to editing', () => {
      const { selectCell, enterEdit, getMode, getEditTrigger } = useNavigationStore.getState();
      selectCell([0, 1]);
      enterEdit('f2');
      expect(getMode()).toBe('editing');
      expect(getEditTrigger()).toBe('f2');
    });

    it('stores initial character for type-replace', () => {
      const { selectCell, enterEdit, getInitialChar } = useNavigationStore.getState();
      selectCell([0, 1]);
      enterEdit('type-replace', 'a');
      expect(getInitialChar()).toBe('a');
    });

    it('does nothing when in browsing mode', () => {
      const { enterEdit, getMode } = useNavigationStore.getState();
      enterEdit('f2');
      expect(getMode()).toBe('browsing');
    });
  });

  describe('exitEdit', () => {
    it('transitions from editing to selected on commit', () => {
      const { selectCell, enterEdit, exitEdit, getMode } = useNavigationStore.getState();
      selectCell([0, 1]);
      enterEdit('f2');
      exitEdit(true);
      expect(getMode()).toBe('selected');
    });

    it('transitions from editing to selected on cancel', () => {
      const { selectCell, enterEdit, exitEdit, getMode } = useNavigationStore.getState();
      selectCell([0, 1]);
      enterEdit('f2');
      exitEdit(false);
      expect(getMode()).toBe('selected');
    });

    it('clears edit trigger and initial char', () => {
      const { selectCell, enterEdit, exitEdit, getEditTrigger, getInitialChar } = useNavigationStore.getState();
      selectCell([0, 1]);
      enterEdit('type-replace', 'x');
      exitEdit(true);
      expect(getEditTrigger()).toBeNull();
      expect(getInitialChar()).toBeNull();
    });
  });

  describe('clearSelection', () => {
    it('transitions to browsing mode', () => {
      const { selectCell, clearSelection, getMode, getSelectedCell } = useNavigationStore.getState();
      selectCell([0, 1]);
      clearSelection();
      expect(getMode()).toBe('browsing');
      expect(getSelectedCell()).toBeNull();
    });
  });

  describe('moveSelection', () => {
    it('moves selection in the specified direction', () => {
      const store = useNavigationStore.getState();
      store.selectCell([1, 1]);

      store.moveSelection('up', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([1, 0]);

      store.moveSelection('down', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([1, 1]);

      store.moveSelection('left', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([0, 1]);

      store.moveSelection('right', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([1, 1]);
    });

    it('respects bounds and does not move past edges', () => {
      const store = useNavigationStore.getState();
      store.selectCell([0, 0]);

      store.moveSelection('up', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([0, 0]);

      store.moveSelection('left', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([0, 0]);
    });

    it('does nothing when in editing mode', () => {
      const store = useNavigationStore.getState();
      store.selectCell([1, 1]);
      store.enterEdit('f2');
      store.moveSelection('up', { maxCol: 10, maxRow: 10 });
      expect(store.getSelectedCell()).toEqual([1, 1]);
    });
  });
});
