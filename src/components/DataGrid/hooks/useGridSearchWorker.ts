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

  // Stable column fields list — avoids re-serializing all cells when column widths change (#9 fix)
  const columnFieldsKey = useMemo(() => columns.map((c) => c.field).join("\0"), [columns]);

  // Stringify row values once (shared between main-thread and worker paths)
  const rowValues = useMemo(() => {
    const fields = columnFieldsKey.split("\0");
    return rows.map((row) =>
      fields.map((field) => {
        const cell = row[field];
        if (!cell || cell.value === null || cell.value === undefined) return "";
        return typeof cell.value === "string"
          ? cell.value
          : JSON.stringify(cell.value);
      }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- columnFieldsKey is a stable string derived from columns
  }, [rows, columnFieldsKey]);

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

  // Dispatch search (or clear result for empty term)
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const trimmed = searchTerm.trim();

    // No search term - clear pending and reset result
    if (!trimmed) {
      requestIdRef.current += 1;
      setWorkerResult(null); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }

    // Debounce both paths to avoid work on every keystroke (#8 fix)
    debounceTimerRef.current = setTimeout(() => {
      if (rows.length <= WORKER_THRESHOLD) {
        // Small dataset - filter on main thread
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
        setWorkerResult(indices); // eslint-disable-line react-hooks/set-state-in-effect
      } else {
        // Large dataset - send to worker
        const id = ++requestIdRef.current;
        const worker = getWorker();
        const request: GridSearchRequest = {
          id,
          rowValues,
          searchTerm: trimmed,
        };
        worker.postMessage(request);
      }
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
