import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import type { CellValue } from "@/types/cellValue";
import type { GridColumnV2 } from "../types";
import { computeArrayStringsFromRaw } from "../utils/arrayFormat";
import { coerceToHstoreString } from "../renderers/HStoreCell/hstoreFormat";

// Cache for memoizing cell creation
const cellCache = new WeakMap<CellValue, Map<string, GridCell>>();

const NUMERIC_TYPE_TOKENS = new Set([
  "number",
  "numeric",
  "decimal",
  "dec",
  "float",
  "float4",
  "float8",
  "double",
  "real",
  "int",
  "int2",
  "int4",
  "int8",
  "integer",
  "bigint",
  "smallint",
  "tinyint",
  "mediumint",
  "serial",
  "bigserial",
  "smallserial",
]);

/**
 * Helper to cache cell results
 */
const cacheAndReturn = (
  value: CellValue | null | undefined,
  columnId: string,
  readOnly: boolean,
  result: GridCell,
): GridCell => {
  const finalized =
    readOnly && (result.allowOverlay !== false || result.readonly !== true)
      ? { ...result, allowOverlay: false, readonly: true }
      : result;

  if (value && typeof value === "object") {
    const cacheKey = readOnly ? `${columnId}:ro` : `${columnId}:rw`;
    let cache = cellCache.get(value);
    if (!cache) {
      cache = new Map<string, GridCell>();
      cellCache.set(value, cache);
    }
    cache.set(cacheKey, finalized);
  }
  return finalized;
};

/**
 * Build a clean GridCell for V2 without custom cell baggage
 */
export function buildGridCellV2(opts: {
  value: CellValue | null | undefined;
  column: GridColumnV2;
  readOnly?: boolean;
}): GridCell {
  const { value, column, readOnly = false } = opts;
  const cacheKey = readOnly ? `${column.id}:ro` : `${column.id}:rw`;

  // Try to get from cache first
  if (value && typeof value === "object") {
    const columnCache = cellCache.get(value);
    const cached = columnCache?.get(cacheKey);
    if (cached) return cached;
  }

  const rawValue = value?.value;
  const dbType = column.meta?.db_type.toLowerCase() || "";
  const normalizedDbType = dbType.replace(/[(),]/g, " ");
  const dbTypeTokens = normalizedDbType
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const isNumericDbType = dbTypeTokens.some((token) =>
    NUMERIC_TYPE_TOKENS.has(token),
  );
  const isArrayDbType =
    dbType.includes("array") || dbType.startsWith("_") || dbType.endsWith("[]");

  // Enum cells - use custom cell to support enum values
  if (column.meta?.enum_values && column.meta.enum_values.length > 0) {
    const enumValue =
      rawValue === null || rawValue === undefined ? null : String(rawValue);

    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "enum-cell",
        value: enumValue,
        allowedValues: column.meta.enum_values,
        nullable: Boolean(
          (column.meta as { nullable?: boolean } | null)?.nullable,
        ),
      },
      copyData: enumValue ?? "NULL",
      allowOverlay: true,
      readonly: false,
      contentAlign: "left",
    });
  }

  // Boolean cells - use custom cell to support null values (including NULL)
  if (dbType.includes("bool") || typeof rawValue === "boolean") {
    let boolValue: boolean | null = null;

    if (rawValue === null || rawValue === undefined) {
      boolValue = null;
    } else if (typeof rawValue === "boolean") {
      boolValue = rawValue;
    } else if (typeof rawValue === "string") {
      // Handle string representations of booleans
      const lowerValue = rawValue.toLowerCase();
      if (lowerValue === "true" || lowerValue === "t" || lowerValue === "1") {
        boolValue = true;
      } else if (
        lowerValue === "false" ||
        lowerValue === "f" ||
        lowerValue === "0"
      ) {
        boolValue = false;
      } else {
        boolValue = null;
      }
    } else if (typeof rawValue === "number") {
      boolValue = rawValue !== 0;
    }

    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "boolean-cell",
        value: boolValue,
      },
      copyData: boolValue === null ? "NULL" : String(boolValue),
      allowOverlay: true,
      readonly: false,
      contentAlign: "center",
    });
  }

  // Money cells - format with currency symbol
  if (dbType.includes("money")) {
    if (rawValue == null) {
      return cacheAndReturn(value, column.id, readOnly, {
        kind: GridCellKind.Text,
        data: "NULL",
        displayData: "NULL",
        allowOverlay: false,
        readonly: false,
        contentAlign: "right",
        themeOverride: {
          textDark: "rgba(127,127,127,0.7)",
          baseFontStyle: "italic 12px",
        },
      });
    }
    const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Text,
      data: String(rawValue),
      displayData: isNaN(num) ? String(rawValue) : num.toFixed(2),
      allowOverlay: false,
      readonly: false,
      contentAlign: "right",
    });
  }

  // Number cells - preserve precision by round-tripping as strings
  if (
    isNumericDbType ||
    typeof rawValue === "number" ||
    typeof rawValue === "bigint"
  ) {
    const numericString =
      rawValue === null || rawValue === undefined
        ? null
        : typeof rawValue === "bigint"
        ? rawValue.toString()
        : typeof rawValue === "number"
        ? Number.isFinite(rawValue)
          ? rawValue.toString()
          : String(rawValue)
        : String(rawValue);

    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "number-cell",
        value: numericString,
        nullable: Boolean(column.meta?.nullable),
        dbType,
        precision: column.meta?.precision,
        scale: column.meta?.scale,
      },
      copyData: numericString ?? "NULL",
      allowOverlay: true,
      readonly: false,
      contentAlign: "right",
    });
  }

  // JSON/JSONB cells - use custom JSON editor
  if (dbType.includes("json")) {
    let jsonString: string | null = null;
    let isValid = true;

    if (rawValue != null) {
      if (typeof rawValue === "string") {
        jsonString = rawValue;
      } else {
        try {
          jsonString = JSON.stringify(rawValue, null, 2);
        } catch {
          jsonString = String(rawValue);
          isValid = false;
        }
      }

      // Validate JSON
      if (jsonString) {
        try {
          JSON.parse(jsonString);
        } catch {
          isValid = false;
        }
      }
    }

    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "json-cell",
        value: jsonString,
        nullable: Boolean(column.meta?.nullable),
        isValid,
      },
      copyData: jsonString ?? "NULL",
      allowOverlay: true,
      readonly: false,
    });
  }

  if (dbType.includes("hstore")) {
    const hstoreString = coerceToHstoreString(rawValue);

    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "hstore-cell",
        value: hstoreString,
        nullable: Boolean(column.meta?.nullable),
      },
      copyData: hstoreString ?? "NULL",
      allowOverlay: true,
      readonly: false,
      contentAlign: "left",
      themeOverride: {
        baseFontStyle: "400 11px monospace",
      },
    });
  }

  // Array cells - inline display with formatted editor
  if (isArrayDbType || Array.isArray(rawValue)) {
    const { pretty, inline } = computeArrayStringsFromRaw(rawValue);

    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "text-multi-cell",
        value: pretty,
        displayValue: inline,
        nullable: Boolean(column.meta?.nullable),
        showLineBadge: false,
        formatDisplayMode: "array-inline",
      },
      copyData: inline ?? "NULL",
      allowOverlay: true,
      readonly: false,
      contentAlign: "left",
      themeOverride: {
        baseFontStyle: "400 11px monospace",
      },
    });
  }

  // Date/Time cells - provide custom editor with calendar popover
  if (dbType.includes("timestamptz") || dbType.includes("timestamp")) {
    const v = rawValue == null ? null : String(rawValue);
    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "datetime-cell",
        value: v,
        nullable: Boolean(column.meta?.nullable),
      },
      copyData: v ?? "NULL",
      allowOverlay: true,
      readonly: false,
    });
  }

  // PostgreSQL tstzrange -> custom range editor
  if (dbType.includes("tstzrange")) {
    const v = rawValue == null ? null : String(rawValue);
    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "tstzrange-cell",
        value: v,
      },
      copyData: v ?? "",
      allowOverlay: true,
      readonly: false,
    });
  }

  if (dbType.includes("date")) {
    const v = rawValue == null ? null : String(rawValue);
    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "date-cell",
        value: v,
        nullable: Boolean(column.meta?.nullable),
      },
      copyData: v ?? "NULL",
      allowOverlay: true,
      readonly: false,
    });
  }

  if (dbType.includes("time")) {
    const v = rawValue == null ? null : String(rawValue);
    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "time-cell",
        value: v,
        nullable: Boolean(column.meta?.nullable),
      },
      copyData: v ?? "NULL",
      allowOverlay: true,
      readonly: false,
    });
  }

  // UUID cells - use custom UUID editor with generation
  if (dbType.includes("uuid")) {
    const uuidString = rawValue == null ? null : String(rawValue);

    // Validate UUID format
    const UUID_REGEX =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const isValid = uuidString ? UUID_REGEX.test(uuidString) : true;

    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "uuid-cell",
        value: uuidString,
        nullable: Boolean(column.meta?.nullable),
        isValid,
      },
      copyData: uuidString ?? "NULL",
      allowOverlay: true,
      readonly: false,
    });
  }

  // Reference/FK cells - use custom reference editor with search
  // Check if column has FK reference data (may be EnhancedColumnMeta)
  const metaWithFk = column.meta as
    | {
        fk_reference?: {
          referenced_schema: string;
          referenced_table: string;
          referenced_column: string;
        };
      }
    | null
    | undefined;
  const fkRef = metaWithFk?.fk_reference;
  if (column.meta?.is_fk && fkRef) {
    const refValue = rawValue == null ? null : rawValue;

    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "reference-cell",
        value: refValue as string | number | null,
        nullable: column.meta.nullable,
        fkReference: {
          schema: fkRef.referenced_schema,
          table: fkRef.referenced_table,
          column: fkRef.referenced_column,
        },
      },
      copyData: refValue ? String(refValue) : "NULL",
      allowOverlay: true,
      readonly: false,
    });
  }

  // Single-line text cells (char, varchar, nvarchar, etc. with length < 200)
  const textValue = rawValue == null ? null : String(rawValue);
  const textLength = textValue ? textValue.length : 0;

  if (
    (dbType.includes("char") || dbType.includes("varying")) &&
    textLength < 200
  ) {
    // Check for character_maximum_length (may be EnhancedColumnMeta)
    const metaWithMaxLen = column.meta as
      | { character_maximum_length?: number | null }
      | null
      | undefined;
    const maxLength = metaWithMaxLen?.character_maximum_length;

    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "text-single-cell",
        value: textValue,
        nullable: column.meta ? column.meta.nullable : false,
        maxLength: maxLength ?? undefined,
      },
      copyData: textValue ?? "NULL",
      allowOverlay: true,
      readonly: false,
    });
  }

  // Multi-line text cells (text, longtext, mediumtext, ntext, clob, or long content)
  if (dbType.includes("text") || dbType.includes("clob") || textLength >= 200) {
    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Custom,
      data: {
        kind: "text-multi-cell",
        value: textValue,
        nullable: column.meta ? column.meta.nullable : false,
      },
      copyData: textValue !== null ? textValue : "NULL",
      allowOverlay: true,
      readonly: false,
    });
  }

  // Handle NULL values for non-boolean columns
  if (rawValue === null || rawValue === undefined) {
    const isNumericColumn =
      dbType.includes("int") ||
      dbType.includes("numeric") ||
      dbType.includes("decimal") ||
      dbType.includes("float") ||
      dbType.includes("double") ||
      dbType.includes("real") ||
      dbType.includes("money");

    return cacheAndReturn(value, column.id, readOnly, {
      kind: GridCellKind.Text,
      data: "NULL",
      displayData: "NULL",
      allowOverlay: false,
      readonly: false,
      contentAlign: isNumericColumn ? "right" : "left",
      themeOverride: {
        textDark: "rgba(127,127,127,0.7)",
        baseFontStyle: "italic 12px",
      },
    });
  }

  // Default: Text cell
  const text = String(rawValue);
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Text,
    data: text,
    displayData: text, // Will be truncated by the adapter
    allowOverlay: true,
    readonly: false,
  });
}
