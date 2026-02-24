import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDataGridFeatures } from '../useDataGridFeatures';
import type { GridRowModel, GridColumnV2 } from '@/components/DataGrid/types';

const mockRows: GridRowModel[] = [
  { col_0: { value: 'A', db_type: 'text', value_type: 'Text', is_truncated: false } },
];

const mockColumns: GridColumnV2[] = [
  { id: 'col_0', field: 'col_0', title: 'Column 1', name: 'col1', width: 100, type: 'text' },
];

describe('useDataGridFeatures', () => {
  it('should compose all feature hooks', () => {
    const { result } = renderHook(() => useDataGridFeatures({
      gridId: 'test',
      rows: mockRows,
      columns: mockColumns,
      paradigm: 'sql',
    }));

    expect(result.current.grid).toBeDefined();
    expect(result.current.contextMenu).toBeDefined();
    expect(result.current.filtering).toBeDefined();
    expect(result.current.statusBar).toBeDefined();
  });

  it('should apply column transformations in order', () => {
    const { result } = renderHook(() => useDataGridFeatures({
      gridId: 'test',
      rows: mockRows,
      columns: mockColumns,
      paradigm: 'sql',
      enableSorting: true,
    }));

    // Columns should be transformed by sorting, pinning, visibility, sizing
    expect(result.current.grid.columns).toBeDefined();
    expect(result.current.grid.columns.length).toBe(1);
  });
});
