import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCellStateIndicator } from './useCellStateIndicator';
import { useCellStateStore } from '../stores/cellStateStore';
import { useValidationStore } from '@/stores/validationStore';

describe('useCellStateIndicator', () => {
  beforeEach(() => {
    useCellStateStore.getState().reset();
    useValidationStore.getState().reset();
  });

  it('returns idle state for cells with no state', () => {
    const { result } = renderHook(() =>
      useCellStateIndicator({ tableKey: 'table' })
    );

    expect(result.current.getCellIndicator(0, 'name')).toEqual({
      state: 'idle',
      hasError: false,
      isDirty: false,
    });
  });

  it('returns focused state for focused cell', () => {
    const { result } = renderHook(() =>
      useCellStateIndicator({ tableKey: 'table' })
    );

    act(() => {
      useCellStateStore.getState().focus('table:0:name');
    });

    expect(result.current.getCellIndicator(0, 'name').state).toBe('focused');
  });

  it('returns dirty state with indicator', () => {
    const { result } = renderHook(() =>
      useCellStateIndicator({ tableKey: 'table' })
    );

    act(() => {
      useCellStateStore.getState().focus('table:0:name');
      useCellStateStore.getState().startEdit('old');
      useCellStateStore.getState().submitValue('new');
    });

    const indicator = result.current.getCellIndicator(0, 'name');
    expect(indicator.state).toBe('dirty');
    expect(indicator.isDirty).toBe(true);
  });

  it('returns error state with validation error', () => {
    const { result } = renderHook(() =>
      useCellStateIndicator({ tableKey: 'table' })
    );

    act(() => {
      useValidationStore.getState().setError('table:0:name', {
        message: 'Invalid',
        type: 'format',
      });
    });

    const indicator = result.current.getCellIndicator(0, 'name');
    expect(indicator.hasError).toBe(true);
    expect(indicator.errorMessage).toBe('Invalid');
  });
});
