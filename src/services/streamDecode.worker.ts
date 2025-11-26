import { decode } from "@msgpack/msgpack";
import type { ColumnMeta } from "@/types/database";
import type { TableDataRow } from "./tableDataTypes";
import type { CellValue as BackendCellValue } from "./backend";
import {
  mapRowsToTableData,
  normalizeBackendValue,
  deriveValueType,
} from "./tableDataTransform";

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

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<StreamWorkerRequest>) => {
  const message = event.data;

  if (!message || typeof message !== "object") {
    return;
  }

  const respond = (response: StreamWorkerResponse) => {
    ctx.postMessage(response);
  };

  try {
    if (message.type === "decode") {
      // Decode MessagePack payload off the main thread
      const rows = decode(new Uint8Array(message.buffer), {
        useBigInt64: true,
      }) as BackendCellValue[][];

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
          tableRow[column.name] = {
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

    respond({
      id: message.id,
      type: "error",
      error: "Unknown worker request type",
    });
  } catch (error) {
    respond({
      id: message.id,
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
