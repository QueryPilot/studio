import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardNavigation } from './useKeyboardNavigation';
import { useNavigationStore } from '../stores/navigationStore';
import { useCellStateStore } from '../stores/cellStateStore';

describe('useKeyboardNavigation', () => {
  const mockGridRef = { current: null };
  const defaultOptions = {
    tableKey: 'test-table',
    gridRef: mockGridRef as React.RefObject<null>,
    bounds: { maxCol: 10, maxRow: 100 },
    columns: [{ field: 'name' }, { field: 'email' }, { field: 'age' }],
    onClearCell: vi.fn(),
    enabled: true,
  };

  beforeEach(() => {
    useNavigationStore.getState().reset();
    useCellStateStore.getState().reset();
    vi.clearAllMocks();
  });

  const createKeyEvent = (key: string, opts: Partial<React.KeyboardEvent> = {}) => ({
    key,
    preventDefault: vi.fn(),
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...opts,
  } as unknown as React.KeyboardEvent);

  describe('handleCellClick', () => {
    it('selects cell on single click', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([2, 5]);
      });

      expect(useNavigationStore.getState().getMode()).toBe('selected');
      expect(useNavigationStore.getState().getSelectedCell()).toEqual([2, 5]);
    });

    it('focuses cell in cellStateStore', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([1, 3]);
      });

      expect(useCellStateStore.getState().getCellState('test-table:3:email')).toBe('focused');
    });
  });

  describe('handleCellDoubleClick', () => {
    it('enters edit mode on double click', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellDoubleClick([2, 5]);
      });

      expect(useNavigationStore.getState().getMode()).toBe('editing');
      expect(useNavigationStore.getState().getEditTrigger()).toBe('double-click');
    });
  });

  describe('handleEditComplete', () => {
    it('exits edit mode and moves selection on commit', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([2, 5]);
        useNavigationStore.getState().enterEdit('f2');
      });

      act(() => {
        result.current.handleEditComplete(true, 'down');
      });

      expect(useNavigationStore.getState().getMode()).toBe('selected');
      expect(useNavigationStore.getState().getSelectedCell()).toEqual([2, 6]);
    });

    it('cancels edit on commit=false', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([2, 5]);
        useNavigationStore.getState().enterEdit('f2');
        useCellStateStore.getState().startEdit('original');
      });

      act(() => {
        result.current.handleEditComplete(false);
      });

      expect(useNavigationStore.getState().getMode()).toBe('selected');
      expect(useCellStateStore.getState().getCellState('test-table:5:age')).toBe('focused');
    });
  });

  describe('keyboard navigation', () => {
    it('moves selection with arrow keys in selected mode', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([5, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('ArrowUp'));
      });

      expect(useNavigationStore.getState().getSelectedCell()).toEqual([5, 4]);
    });

    it('enters edit mode on F2', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([5, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('F2'));
      });

      expect(useNavigationStore.getState().getMode()).toBe('editing');
      expect(useNavigationStore.getState().getEditTrigger()).toBe('f2');
    });

    it('enters edit mode on Enter', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([5, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('Enter'));
      });

      expect(useNavigationStore.getState().getMode()).toBe('editing');
      expect(useNavigationStore.getState().getEditTrigger()).toBe('enter');
    });

    it('enters edit mode with initial char on printable key', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([5, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('a'));
      });

      expect(useNavigationStore.getState().getMode()).toBe('editing');
      expect(useNavigationStore.getState().getEditTrigger()).toBe('type-replace');
      expect(useNavigationStore.getState().getInitialChar()).toBe('a');
    });

    it('clears selection on Escape in selected mode', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([5, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('Escape'));
      });

      expect(useNavigationStore.getState().getMode()).toBe('browsing');
      expect(useNavigationStore.getState().getSelectedCell()).toBeNull();
    });

    it('calls onClearCell on Delete key', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([1, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('Delete'));
      });

      expect(defaultOptions.onClearCell).toHaveBeenCalledWith([1, 5], 'email');
    });

    it('moves right on Tab', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([1, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('Tab'));
      });

      expect(useNavigationStore.getState().getSelectedCell()).toEqual([2, 5]);
    });

    it('moves left on Shift+Tab', () => {
      const { result } = renderHook(() => useKeyboardNavigation(defaultOptions));

      act(() => {
        result.current.handleCellClick([1, 5]);
      });

      act(() => {
        result.current.handleKeyDown(createKeyEvent('Tab', { shiftKey: true }));
      });

      expect(useNavigationStore.getState().getSelectedCell()).toEqual([0, 5]);
    });
  });

  describe('disabled state', () => {
    it('does nothing when disabled', () => {
      const disabledOptions = { ...defaultOptions, enabled: false };
      const { result } = renderHook(() => useKeyboardNavigation(disabledOptions));

      act(() => {
        result.current.handleCellClick([2, 5]);
      });

      expect(useNavigationStore.getState().getMode()).toBe('browsing');
    });
  });
});
