import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useColumnVisibility } from '../useColumnVisibility';
import type { GridColumnV2 } from '@/components/DataGrid/types';

const mockColumns: GridColumnV2[] = [
  { id: 'col_0', field: 'col_0', title: 'Column 1', name: 'col1', width: 100, type: 'text' },
  { id: 'col_1', field: 'col_1', title: 'Column 2', name: 'col2', width: 100, type: 'text' },
  { id: 'col_2', field: 'col_2', title: 'Column 3', name: 'col3', width: 100, type: 'text' },
];

describe('useColumnVisibility', () => {
  it('should initialize with all columns visible by default', () => {
    const { result } = renderHook(() => useColumnVisibility({
      columns: mockColumns,
    }));

    expect(result.current.visibleColumns).toHaveLength(3);
    expect(result.current.isVisible('col_0')).toBe(true);
    expect(result.current.isVisible('col_1')).toBe(true);
    expect(result.current.isVisible('col_2')).toBe(true);
  });

  it('should initialize with specified hidden columns', () => {
    const { result } = renderHook(() => useColumnVisibility({
      columns: mockColumns,
      initialHidden: ['col_0', 'col_2'],
    }));

    expect(result.current.visibleColumns).toHaveLength(1);
    expect(result.current.isVisible('col_0')).toBe(false);
    expect(result.current.isVisible('col_1')).toBe(true);
    expect(result.current.isVisible('col_2')).toBe(false);
  });

  it('should hide columns', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useColumnVisibility({
      columns: mockColumns,
      initialHidden: [],
      onChange,
    }));

    act(() => {
      result.current.hide('col_0');
    });

    expect(result.current.visibleColumns).toHaveLength(2);
    expect(result.current.isVisible('col_0')).toBe(false);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ col_0: false })
    );
  });

  it('should show hidden columns', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useColumnVisibility({
      columns: mockColumns,
      initialHidden: ['col_0'],
      onChange,
    }));

    act(() => {
      result.current.show('col_0');
    });

    expect(result.current.visibleColumns).toHaveLength(3);
    expect(result.current.isVisible('col_0')).toBe(true);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ col_0: true })
    );
  });

  it('should toggle column visibility', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useColumnVisibility({
      columns: mockColumns,
      onChange,
    }));

    // Toggle visible -> hidden
    act(() => {
      result.current.toggle('col_0');
    });
    expect(result.current.isVisible('col_0')).toBe(false);

    // Toggle hidden -> visible
    act(() => {
      result.current.toggle('col_0');
    });
    expect(result.current.isVisible('col_0')).toBe(true);
  });

  it('should show all columns', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useColumnVisibility({
      columns: mockColumns,
      initialHidden: ['col_0', 'col_1'],
      onChange,
    }));

    expect(result.current.visibleColumns).toHaveLength(1);

    act(() => {
      result.current.showAll();
    });

    expect(result.current.visibleColumns).toHaveLength(3);
    expect(result.current.isVisible('col_0')).toBe(true);
    expect(result.current.isVisible('col_1')).toBe(true);
    expect(result.current.isVisible('col_2')).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it('should handle non-existent column IDs gracefully', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useColumnVisibility({
      columns: mockColumns,
      onChange,
    }));

    // Should not throw
    act(() => {
      result.current.hide('non_existent');
    });

    expect(result.current.visibleColumns).toHaveLength(3);
  });

  it('should preserve visibility state when columns change', () => {
    const { result, rerender } = renderHook(
      ({ columns }) => useColumnVisibility({ columns }),
      { initialProps: { columns: mockColumns } }
    );

    act(() => {
      result.current.hide('col_0');
    });
    expect(result.current.isVisible('col_0')).toBe(false);

    // Change columns but keep same IDs
    const newColumns = [...mockColumns];
    rerender({ columns: newColumns });

    expect(result.current.isVisible('col_0')).toBe(false);
  });

  it('should call onChange with correct visibility map', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useColumnVisibility({
      columns: mockColumns,
      onChange,
    }));

    act(() => {
      result.current.hide('col_0');
    });

    expect(onChange).toHaveBeenCalledWith({
      col_0: false,
      col_1: true,
      col_2: true,
    });
  });

  it('should not react to initialHidden changes after mount', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ initialHidden }) => useColumnVisibility({
        columns: mockColumns,
        initialHidden,
        onChange,
      }),
      { initialProps: { initialHidden: [] as string[] } }
    );

    // All columns should be visible initially
    expect(result.current.visibleColumns).toHaveLength(3);

    onChange.mockClear();

    // Change initialHidden after mount
    rerender({ initialHidden: ['col_0'] });

    // Should NOT sync - initialHidden only affects initial state
    // Columns should still all be visible
    expect(result.current.visibleColumns).toHaveLength(3);
    expect(result.current.isVisible('col_0')).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
