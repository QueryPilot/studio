import { useCallback, useRef, startTransition } from 'react';
import type { ColumnMeta } from '@/types/schema';

interface StreamingState {
  columns: string[];
  columnMeta: ColumnMeta[];
  rows: unknown[][];
  totalRows: number;
  executionTime: number;
}

interface UseQueryStreamingOptions {
  onUpdate: (state: StreamingState) => void;
}

interface UseQueryStreamingReturn {
  startStreaming: () => void;
  appendRows: (rows: unknown[][], columns?: string[], columnMeta?: ColumnMeta[]) => void;
  finishStreaming: (totalTime: number) => void;
  reset: () => void;
  getAccumulatedState: () => StreamingState;
  isStreaming: boolean;
}

export function useQueryStreaming(
  options: UseQueryStreamingOptions
): UseQueryStreamingReturn {
  const { onUpdate } = options;

  const accumulatedRowsRef = useRef<unknown[][]>([]);
  const currentColumnsRef = useRef<string[]>([]);
  const currentColumnMetaRef = useRef<ColumnMeta[]>([]);
  const renderedCountRef = useRef(0);
  const hasRenderedOnceRef = useRef(false);
  const rafPendingRef = useRef(false);
  const isStreamingRef = useRef(false);

  const flushUpdate = useCallback(() => {
    const rows = accumulatedRowsRef.current;
    if (rows.length === 0) return;

    const state: StreamingState = {
      columns: currentColumnsRef.current,
      columnMeta: currentColumnMetaRef.current,
      rows: rows.slice(0),
      totalRows: rows.length,
      executionTime: 0,
    };

    // First render is synchronous to avoid skeleton flash
    if (!hasRenderedOnceRef.current) {
      hasRenderedOnceRef.current = true;
      renderedCountRef.current = rows.length;
      onUpdate(state);
      return;
    }

    // Subsequent renders use startTransition for responsiveness
    startTransition(() => {
      const already = renderedCountRef.current;
      const total = rows.length;
      if (total <= already) return;

      renderedCountRef.current = total;
      onUpdate({
        ...state,
        totalRows: total,
      });
    });
  }, [onUpdate]);

  const scheduleUpdate = useCallback(() => {
    if (rafPendingRef.current) return;

    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      if (accumulatedRowsRef.current.length > renderedCountRef.current) {
        flushUpdate();
      }
    });
  }, [flushUpdate]);

  const startStreaming = useCallback(() => {
    isStreamingRef.current = true;
  }, []);

  const appendRows = useCallback((
    rows: unknown[][],
    columns?: string[],
    columnMeta?: ColumnMeta[]
  ) => {
    if (columns) currentColumnsRef.current = columns;
    if (columnMeta) currentColumnMetaRef.current = columnMeta;

    accumulatedRowsRef.current.push(...rows);
    scheduleUpdate();
  }, [scheduleUpdate]);

  const finishStreaming = useCallback((totalTime: number) => {
    isStreamingRef.current = false;

    // Direct state update to ensure all rows are visible
    const state: StreamingState = {
      columns: currentColumnsRef.current,
      columnMeta: currentColumnMetaRef.current,
      rows: [...accumulatedRowsRef.current],
      totalRows: accumulatedRowsRef.current.length,
      executionTime: totalTime,
    };

    onUpdate(state);
  }, [onUpdate]);

  const reset = useCallback(() => {
    accumulatedRowsRef.current = [];
    currentColumnsRef.current = [];
    currentColumnMetaRef.current = [];
    renderedCountRef.current = 0;
    hasRenderedOnceRef.current = false;
    rafPendingRef.current = false;
    isStreamingRef.current = false;
  }, []);

  const getAccumulatedState = useCallback((): StreamingState => ({
    columns: currentColumnsRef.current,
    columnMeta: currentColumnMetaRef.current,
    rows: accumulatedRowsRef.current,
    totalRows: accumulatedRowsRef.current.length,
    executionTime: 0,
  }), []);

  return {
    startStreaming,
    appendRows,
    finishStreaming,
    reset,
    getAccumulatedState,
    isStreaming: isStreamingRef.current,
  };
}

export type { UseQueryStreamingOptions, UseQueryStreamingReturn };
