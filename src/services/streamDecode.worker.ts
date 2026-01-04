import { Decoder } from "msgpackr";
import type { ColumnMeta } from "@/types/database";
import type { TableDataRow } from "./tableDataTypes";
import type { CellValue as BackendCellValue } from "./backend";
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
  rows: BackendCellValue[][];
  columns: ColumnMeta[];
}

interface MapRowsNormalizedRequest {
  id: number;
  type: "mapRowsNormalized";
  rows: BackendCellValue[][];
  columns: ColumnMeta[];
}

type StreamWorkerRequest =
  | DecodeRequest
  | MapRowsRequest
  | MapRowsNormalizedRequest;

interface StreamWorkerResponse {
  id: number;
  type: "decoded" | "mapped" | "mappedNormalized" | "error";
  rows?: BackendCellValue[][] | TableDataRow[];
  error?: string;
}

// Web Worker context
declare const self: Worker;

self.onmessage = (event: MessageEvent<StreamWorkerRequest>) => {
  const message = event.data;

  if (!message || typeof message !== "object") {
    return;
  }

  const respond = (response: StreamWorkerResponse) => {
    self.postMessage(response);
  };

  try {
    if (message.type === "decode") {
      // Decode MessagePack payload off the main thread (msgpackr is 2-3x faster)
      const rows = decoder.decode(
        new Uint8Array(message.buffer),
      ) as BackendCellValue[][];

      respond({
        id: message.id,
        type: "decoded",
        rows,
      });
      return;
    }

    if (message.type === "mapRows") {
      const mapped = mapRowsToTableData(message.columns, message.rows);
      respond({
        id: message.id,
        type: "mapped",
        rows: mapped,
      });
      return;
    }

    if (message.type === "mapRowsNormalized") {
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

    // Fallback for unknown types - use type assertion
    const unknownMessage = message as StreamWorkerRequest;
    respond({
      id: unknownMessage.id,
      type: "error",
      error: "Unknown worker request type",
    });
  } catch (error) {
    // Use type assertion to get id from caught context
    const errorMessage = message;
    respond({
      id: errorMessage.id,
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
