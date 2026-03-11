import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  analyzeArraySchema,
  type ArraySchemaRequest,
  type ArraySchemaResponse,
  type ArrayLayoutMode,
} from '@/workers/arraySchemaAnalysis.worker';

const WORKER_THRESHOLD = 200;

export interface NestedArrayLayout {
  mode: ArrayLayoutMode;
  /** All unique field names for table mode, empty for typed-value */
  columns: string[];
  /** True while worker is analyzing (only for large arrays) */
  isAnalyzing: boolean;
}

const EMPTY_LAYOUT: NestedArrayLayout = {
  mode: 'typed-value',
  columns: [],
  isAnalyzing: false,
};

/**
 * Analyzes array items to determine the best display layout.
 * Offloads to a web worker for arrays > WORKER_THRESHOLD items.
 */
export function useNestedArrayLayout(
  items: unknown[] | undefined,
  enabled: boolean,
): NestedArrayLayout {
  const [workerLayout, setWorkerLayout] = useState<NestedArrayLayout | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const prevItemsRef = useRef<unknown[] | undefined>(undefined);

  // Lazy worker initialization
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('@/workers/arraySchemaAnalysis.worker.ts', import.meta.url),
        { type: 'module' },
      );
      workerRef.current.onmessage = (event: MessageEvent<ArraySchemaResponse>) => {
        const { id, mode, columns } = event.data;
        if (id === requestIdRef.current) {
          setWorkerLayout({ mode, columns, isAnalyzing: false });
        }
      };
    }
    return workerRef.current;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Sync analysis for small arrays (computed during render)
  const syncLayout = useMemo<NestedArrayLayout | null>(() => {
    if (!enabled || !items || items.length === 0) {
      return EMPTY_LAYOUT;
    }
    if (items.length <= WORKER_THRESHOLD) {
      const result = analyzeArraySchema(items);
      return { ...result, isAnalyzing: false };
    }
    return null; // Large array — handled by worker
  }, [enabled, items]);

  // Dispatch worker for large arrays
  useEffect(() => {
    if (!enabled || !items || items.length <= WORKER_THRESHOLD) {
      return;
    }

    // Skip if same items reference
    if (items === prevItemsRef.current) {
      return;
    }
    prevItemsRef.current = items;

    const id = ++requestIdRef.current;
    setWorkerLayout({ mode: 'typed-value', columns: [], isAnalyzing: true }); // eslint-disable-line react-hooks/set-state-in-effect
    const worker = getWorker();
    const request: ArraySchemaRequest = { id, items };
    worker.postMessage(request);
  }, [enabled, items, getWorker]);

  // Return sync result if available, otherwise worker result
  if (syncLayout !== null) {
    return syncLayout;
  }
  return workerLayout ?? { mode: 'typed-value', columns: [], isAnalyzing: true };
}
