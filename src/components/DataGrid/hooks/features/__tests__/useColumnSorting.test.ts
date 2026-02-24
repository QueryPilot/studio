import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useColumnSorting } from '../useColumnSorting';
import type { GridColumnV2 } from '@/components/DataGrid/types';

const mockColumns: GridColumnV2[] = [
  { id: 'col_0', field: 'col_0', title: 'Column 1', name: 'col1', width: 100, type: 'text' },
  { id: 'col_1', field: 'col_1', title: 'Column 2', name: 'col2', width: 100, type: 'text' },
];

describe('useColumnSorting', () => {
  it('should toggle sort direction on header click', () => {
    const { result } = renderHook(() => useColumnSorting({
      gridId: 'test',
      columns: mockColumns,
    }));

    // First click: ASC
    act(() => {
      result.current.toggleSort('col_0', false);
    });
    expect(result.current.getSortDirection('col_0')).toBe('asc');

    // Second click: DESC
    act(() => {
      result.current.toggleSort('col_0', false);
    });
    expect(result.current.getSortDirection('col_0')).toBe('desc');

    // Third click: clear
    act(() => {
      result.current.toggleSort('col_0', false);
    });
    expect(result.current.getSortDirection('col_0')).toBeUndefined();
  });

  it('should support multi-column sorting with shift key', () => {
    const { result } = renderHook(() => useColumnSorting({
      gridId: 'test',
      columns: mockColumns,
    }));

    act(() => {
      result.current.toggleSort('col_0', false);
    });
    expect(result.current.sortColumns).toHaveLength(1);

    act(() => {
      result.current.toggleSort('col_1', true); // Shift+click
    });
    expect(result.current.sortColumns).toHaveLength(2);
  });
});
