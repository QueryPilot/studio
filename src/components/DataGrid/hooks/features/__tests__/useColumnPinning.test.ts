import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useColumnPinning } from '../useColumnPinning';
import type { GridColumnV2 } from '@/components/DataGrid/types';

const mockColumns: GridColumnV2[] = [
  { id: 'col_0', field: 'col_0', title: 'Column 1', name: 'col1', width: 100, type: 'text' },
  { id: 'col_1', field: 'col_1', title: 'Column 2', name: 'col2', width: 100, type: 'text' },
];

describe('useColumnPinning', () => {
  it('should pin columns', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useColumnPinning({
      columns: mockColumns,
      initialPinned: [],
      onChange,
    }));

    act(() => {
      result.current.pin('col_0');
    });

    expect(result.current.pinnedColumns).toContain('col_0');
    expect(onChange).toHaveBeenCalledWith(['col_0']);
  });

  it('should unpin columns', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useColumnPinning({
      columns: mockColumns,
      initialPinned: ['col_0'],
      onChange,
    }));

    act(() => {
      result.current.unpin('col_0');
    });

    expect(result.current.pinnedColumns).not.toContain('col_0');
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('should toggle columns', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useColumnPinning({
      columns: mockColumns,
      initialPinned: [],
      onChange,
    }));

    // Toggle on
    act(() => {
      result.current.toggle('col_0');
    });

    expect(result.current.pinnedColumns).toContain('col_0');
    expect(onChange).toHaveBeenCalledWith(['col_0']);

    // Toggle off
    act(() => {
      result.current.toggle('col_0');
    });

    expect(result.current.pinnedColumns).not.toContain('col_0');
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('should check if column is pinned with isPinned', () => {
    const { result } = renderHook(() => useColumnPinning({
      columns: mockColumns,
      initialPinned: ['col_0'],
    }));

    expect(result.current.isPinned('col_0')).toBe(true);
    expect(result.current.isPinned('col_1')).toBe(false);
  });

  it('should be idempotent when pinning already pinned column', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useColumnPinning({
      columns: mockColumns,
      initialPinned: ['col_0'],
      onChange,
    }));

    act(() => {
      result.current.pin('col_0');
    });

    // Should not add duplicate
    expect(result.current.pinnedColumns).toEqual(['col_0']);
    // Should not call onChange since state didn't change
    expect(onChange).not.toHaveBeenCalled();
  });

  it('should warn when pinning non-existent column', () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onChange = vi.fn();
    const { result } = renderHook(() => useColumnPinning({
      columns: mockColumns,
      initialPinned: [],
      onChange,
    }));

    act(() => {
      result.current.pin('invalid_column');
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Cannot pin non-existent column: invalid_column'
    );
    expect(result.current.pinnedColumns).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();

    consoleWarnSpy.mockRestore();
  });

  it('should not cause infinite loop when onChange changes', () => {
    const onChange1 = vi.fn();
    const onChange2 = vi.fn();

    const { result, rerender } = renderHook(
      ({ onChange }) => useColumnPinning({
        columns: mockColumns,
        initialPinned: [],
        onChange,
      }),
      {
        initialProps: { onChange: onChange1 },
      }
    );

    // Change the onChange callback
    rerender({ onChange: onChange2 });

    // Pin a column
    act(() => {
      result.current.pin('col_0');
    });

    // Should use the new onChange callback (the ref pattern ensures this)
    expect(onChange2).toHaveBeenCalledWith(['col_0']);
    expect(onChange2).toHaveBeenCalledTimes(1);
    // Should not call the old callback
    expect(onChange1).not.toHaveBeenCalled();
  });
});
