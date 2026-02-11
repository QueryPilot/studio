import { logger } from "@/lib/logger";
import type { ColumnMeta } from "@/types/database";
import type { TableDataRow } from "./tableDataTypes";
import type { CellValue as BackendCellValue } from "./backend";

type DecodeResult = BackendCellValue[][];

interface StreamWorkerDecoded {
  id: number;
  type: "decoded";
  rows?: DecodeResult;
  error?: string;
}

interface StreamWorkerMapped {
  id: number;
  type: "mapped";
  rows?: TableDataRow[];
  error?: string;
}

interface StreamWorkerMappedNormalized {
  id: number;
  type: "mappedNormalized";
  rows?: TableDataRow[];
  error?: string;
}

type StreamWorkerResponse =
  | StreamWorkerDecoded
  | StreamWorkerMapped
  | StreamWorkerMappedNormalized;

class StreamDecodeWorkerManager {
  private worker: Worker | null = null;
  private requestId = 0;
  private pending = new Map<
    number,
    {
      resolve: (rows: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private static IDLE_TIMEOUT_MS = 60_000; // Tear down the worker after 60s idle

  private ensureWorker(): void {
    if (this.worker) return;

    this.worker = new Worker(
      new URL("./streamDecode.worker.ts", import.meta.url),
      { type: "module" },
    );

    this.worker.onmessage = (event: MessageEvent<StreamWorkerResponse>) => {
      const { id, rows, error } = event.data;
      const pending = this.pending.get(id);
      if (!pending) return;

      clearTimeout(pending.timeout);
      this.pending.delete(id);

      if (error) {
        pending.reject(new Error(error));
        return;
      }

      if (!rows) {
        pending.reject(new Error("No rows returned from worker"));
        return;
      }

      pending.resolve(rows);
    };

    this.worker.onerror = (error) => {
      // Reject all pending requests if the worker crashes
      for (const [id, pending] of this.pending.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Worker error for request ${id}`));
        this.pending.delete(id);
      }
      logger.error("stream-decode-worker", "Worker error", error);
    };

    // Clear idle timer on new work
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private scheduleIdleTeardown(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.terminateWorker();
    }, StreamDecodeWorkerManager.IDLE_TIMEOUT_MS);
  }

  private terminateWorker(): void {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch (error) {
        logger.warn(
          "stream-decode-worker",
          "Failed to terminate worker during idle teardown",
          error,
        );
      }
      this.worker = null;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private send<T extends StreamWorkerResponse["rows"]>(
    payload: Record<string, unknown> & { type: string },
  ): Promise<T> {
    this.ensureWorker();
    if (!this.worker) {
      return Promise.reject(new Error("Stream decode worker not initialized"));
    }

    const id = ++this.requestId;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("Stream decode worker timed out"));
        }
      }, 5000);

      this.pending.set(id, { resolve: resolve as (rows: unknown) => void, reject, timeout });

      const transfers: Transferable[] = [];
      if ("buffer" in payload && payload.buffer instanceof ArrayBuffer) {
        transfers.push(payload.buffer);
      }

      this.worker!.postMessage({ ...payload, id }, transfers);
      // Schedule teardown after current work completes
      this.scheduleIdleTeardown();
    });
  }

  decode(buffer: ArrayBuffer): Promise<DecodeResult> {
    return this.send<DecodeResult>({ type: "decode", buffer });
  }

  mapRows(
    rows: BackendCellValue[][],
    columns: ColumnMeta[],
  ): Promise<TableDataRow[]> {
    return this.send<TableDataRow[]>({
      type: "mapRows",
      rows,
      columns,
    });
  }

  mapRowsNormalized(
    rows: BackendCellValue[][],
    columns: ColumnMeta[],
  ): Promise<TableDataRow[]> {
    return this.send<TableDataRow[]>({
      type: "mapRowsNormalized",
      rows,
      columns,
    });
  }
}

let workerInstance: StreamDecodeWorkerManager | null = null;

export function getStreamDecodeWorker(): StreamDecodeWorkerManager {
  if (!workerInstance) {
    workerInstance = new StreamDecodeWorkerManager();
  }
  return workerInstance;
}

export function terminateStreamDecodeWorker(): void {
  if (workerInstance) {
    // Best effort cleanup - use any cast to call private method
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (workerInstance as any).terminateWorker();
    } catch (error) {
      logger.warn(
        "stream-decode-worker",
        "Failed to terminate worker via public API",
        error,
      );
    }
    workerInstance = null;
  }
}
