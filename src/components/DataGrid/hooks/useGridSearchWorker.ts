import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { GridSearchRequest, GridSearchResponse } from "@/workers/gridSearch.worker";
import type { GridRowModel, GridColumnV2 } from "../types";

const WORKER_THRESHOLD = 1000;
const DEBOUNCE_MS = 150;

/**
 * Hook that filters rows by search term, offloading to a web worker
 * when the row count exceeds WORKER_THRESHOLD.
 */
export function useGridSearchWorker(
  rows: GridRowModel[],
  columns: GridColumnV2[],
  searchTerm: string,
): GridRowModel[] {
  const [workerResult, setWorkerResult] = useState<number[] | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stringify row values once (shared between main-thread and worker paths)
  const rowValues = useMemo(() => {
    return rows.map((row) =>
      columns.map((col) => {
        const cell = row[col.field];
        if (!cell || cell.value === null || cell.value === undefined) return "";
        return typeof cell.value === "string"
          ? cell.value
          : JSON.stringify(cell.value);
      }),
    );
  }, [rows, columns]);

  // Initialize worker lazily
  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("@/workers/gridSearch.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current.onmessage = (event: MessageEvent<GridSearchResponse>) => {
        const { id, matchingIndices } = event.data;
        if (id === requestIdRef.current) {
          setWorkerResult(matchingIndices);
        }
      };
    }
    return workerRef.current;
  }, []);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Dispatch search
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const trimmed = searchTerm.trim();

    // No search term - return all rows
    if (!trimmed) {
      setWorkerResult(null);
      return;
    }

    // Small dataset - filter on main thread immediately
    if (rows.length <= WORKER_THRESHOLD) {
      const term = trimmed.toLowerCase();
      const indices: number[] = [];
      for (let i = 0; i < rowValues.length; i++) {
        const row = rowValues[i];
        if (!row) continue;
        for (const cellValue of row) {
          if (cellValue.toLowerCase().includes(term)) {
            indices.push(i);
            break;
          }
        }
      }
      setWorkerResult(indices);
      return;
    }

    // Large dataset - debounce and send to worker
    debounceTimerRef.current = setTimeout(() => {
      const id = ++requestIdRef.current;
      const worker = getWorker();
      const request: GridSearchRequest = {
        id,
        rowValues,
        searchTerm: trimmed,
      };
      worker.postMessage(request);
    }, DEBOUNCE_MS);
  }, [searchTerm, rows.length, rowValues, getWorker]);

  // Return filtered rows
  return useMemo(() => {
    if (!searchTerm.trim() || workerResult === null) {
      return rows;
    }
    return workerResult
      .filter((i) => i < rows.length)
      .map((i) => rows[i])
      .filter((r): r is GridRowModel => r !== undefined);
  }, [rows, searchTerm, workerResult]);
}
