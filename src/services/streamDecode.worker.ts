import { Decoder } from "msgpackr";
import type { ColumnMeta } from "@/types/database";
import type { TableDataRow } from "./tableDataTypes";
import type { RawCellValue } from "./backend";
import {
  mapRowsToTableData,
  normalizeBackendValue,
  deriveValueType,
} from "./tableDataTransform";

// Reusable decoder instance - 2-3x faster than @msgpack/msgpack
const decoder = new Decoder({
  useRecords: false, // Return plain arrays
  mapsAsObjects: true,
  int64AsNumber: false, // CRITICAL: Keep as bigint/string to preserve precision for BIGINT values
  // JavaScript Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991
  // PostgreSQL BIGINT max = 9,223,372,036,854,775,807
  // Must use bigint or string to avoid precision loss
});

interface DecodeRequest {
  id: number;
  type: "decode";
  buffer: ArrayBuffer;
}

interface MapRowsRequest {
  id: number;
  type: "mapRows";
  rows: RawCellValue[][];
  columns: ColumnMeta[];
}

interface MapRowsNormalizedRequest {
  id: number;
  type: "mapRowsNormalized";
  rows: RawCellValue[][];
  columns: ColumnMeta[];
}

interface WarmupRequest {
  id: number;
  type: "warmup";
}

interface StreamWorkerResponse {
  id: number;
  type: "decoded" | "mapped" | "mappedNormalized" | "warmup" | "error";
  rows?: RawCellValue[][] | TableDataRow[];
  error?: string;
}

type WorkerMessageRecord = Record<string, unknown>;
type WorkerMessageWithId = WorkerMessageRecord & { id: number };

// Fast BigInt → string normalizer. Runs in the worker so the main thread
// skips the per-cell normalizeBackendValue() call entirely.
// Uses RawCellValue (which includes bigint) instead of deprecated BackendCellValue.
function normalizeBigIntCell(value: RawCellValue): RawCellValue {
  if (value === null) return value;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) {
    return value.map((item) => normalizeBigIntCell(item));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        normalizeBigIntCell(nestedValue),
      ]),
    ) as RawCellValue;
  }
  return value; // string | number | boolean — pass through
}

function normalizeBigIntRows(rows: RawCellValue[][]): RawCellValue[][] {
  return rows.map((row) => row.map((cell) => normalizeBigIntCell(cell)));
}

// Web Worker context
declare const self: Worker;

function isWorkerMessageRecord(value: unknown): value is WorkerMessageRecord {
  return typeof value === "object" && value !== null;
}

function hasNumericId(message: unknown): message is WorkerMessageWithId {
  return isWorkerMessageRecord(message) && typeof message.id === "number";
}

function isDecodeRequest(message: unknown): message is DecodeRequest {
  return (
    isWorkerMessageRecord(message) &&
    hasNumericId(message) &&
    message.type === "decode" &&
    message.buffer instanceof ArrayBuffer
  );
}

function isMapRowsRequest(message: unknown): message is MapRowsRequest {
  return (
    isWorkerMessageRecord(message) &&
    hasNumericId(message) &&
    message.type === "mapRows" &&
    Array.isArray(message.rows) &&
    Array.isArray(message.columns)
  );
}

function isMapRowsNormalizedRequest(
  message: unknown,
): message is MapRowsNormalizedRequest {
  return (
    isWorkerMessageRecord(message) &&
    hasNumericId(message) &&
    message.type === "mapRowsNormalized" &&
    Array.isArray(message.rows) &&
    Array.isArray(message.columns)
  );
}

function isWarmupRequest(message: unknown): message is WarmupRequest {
  return (
    isWorkerMessageRecord(message) &&
    hasNumericId(message) &&
    message.type === "warmup"
  );
}

self.onmessage = (event: MessageEvent<unknown>) => {
  const message = event.data;

  if (!isWorkerMessageRecord(message)) {
    return;
  }

  const requestId = hasNumericId(message) ? message.id : 0;

  const respond = (response: StreamWorkerResponse) => {
    self.postMessage(response);
  };

  try {
    if (isDecodeRequest(message)) {
      // Decode MessagePack payload off the main thread (msgpackr is 2-3x faster)
      const rows = decoder.decode(new Uint8Array(message.buffer)) as RawCellValue[][];

      // Normalize BigInt → string IN the worker so the main thread never
      // has to run normalizeRawRows(). This moves ~1500 type-checks per batch
      // off the critical path. Only recurse into cells that could contain BigInt.
      const normalized = normalizeBigIntRows(rows);

      respond({
        id: message.id,
        type: "decoded",
        rows: normalized,
      });
      return;
    }

    if (isMapRowsRequest(message)) {
      const mapped = mapRowsToTableData(message.columns, message.rows);
      respond({
        id: message.id,
        type: "mapped",
        rows: mapped,
      });
      return;
    }

    if (isMapRowsNormalizedRequest(message)) {
      const mapped = message.rows.map((row) => {
        const tableRow: TableDataRow = {};
        message.columns.forEach((column, index) => {
          const rawValue = row[index];
          const normalizedValue = normalizeBackendValue(rawValue);
          // Use index-based key to handle duplicate column names in JOINs
          tableRow[`col_${index}`] = {
            value: normalizedValue ?? null,
            db_type: column.db_type,
            value_type: deriveValueType(rawValue, column.db_type),
            is_truncated: false,
            metadata:
              typeof rawValue === "bigint"
                ? {
                    attributes: {
                      originalBigInt: rawValue.toString(),
                    },
                  }
                : undefined,
          };
        });
        return tableRow;
      });

      respond({
        id: message.id,
        type: "mappedNormalized",
        rows: mapped,
      });
      return;
    }

    if (!isWarmupRequest(message)) {
      respond({
        id: requestId,
        type: "error",
        error: "Unknown worker request type",
      });
      return;
    }

    // No-op — just ACK so the caller's promise resolves and the worker thread stays alive
    respond({
      id: requestId,
      type: "warmup",
    });
  } catch (error) {
    respond({
      id: requestId,
      type: "error",
      error:
        error instanceof Error
          ? error.message
          : typeof error === "string"
          ? error
          : "Worker error",
    });
  }
};
