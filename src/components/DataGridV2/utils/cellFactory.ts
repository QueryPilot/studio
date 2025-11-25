import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import type { CellValue } from "@/types/cellValue";
import type { GridColumnV2 } from "../types";
import { computeArrayStringsFromRaw } from "../utils/arrayFormat";
import { coerceToHstoreString } from "../renderers/HStoreCell/hstoreFormat";

// ============================================================================
// Cache Configuration
// ============================================================================

// Cache for memoizing cell creation (keyed by CellValue object identity)
const cellCache = new WeakMap<CellValue, Map<string, GridCell>>();

// Development-mode cache statistics
let cacheHits = 0;
let cacheMisses = 0;

// Pre-compiled UUID regex for validation (avoids regex compilation on every call)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ============================================================================
// Type Detection
// ============================================================================

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

// Column metadata cache to avoid re-parsing db_type on every cell render
interface ParsedColumnMeta {
  dbType: string;
  normalizedDbType: string;
  dbTypeTokens: string[];
  isNumericDbType: boolean;
  isArrayDbType: boolean;
  isBoolDbType: boolean;
  isJsonDbType: boolean;
  isMoneyDbType: boolean;
  isTimestampDbType: boolean;
  isDateDbType: boolean;
  isTimeDbType: boolean;
  isTstzRangeDbType: boolean;
  isUuidDbType: boolean;
  isHstoreDbType: boolean;
  isCharDbType: boolean;
  isTextDbType: boolean;
  isClobDbType: boolean;
}

const columnMetaCache = new WeakMap<GridColumnV2, ParsedColumnMeta>();

function getOrParseColumnMeta(column: GridColumnV2): ParsedColumnMeta {
  let cached = columnMetaCache.get(column);
  if (cached) {
    return cached;
  }

  const dbType = column.meta?.db_type?.toLowerCase() || "";
  const normalizedDbType = dbType.replace(/[(),]/g, " ");
  const dbTypeTokens = normalizedDbType
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  
  const parsed: ParsedColumnMeta = {
    dbType,
    normalizedDbType,
    dbTypeTokens,
    isNumericDbType: dbTypeTokens.some((token) => NUMERIC_TYPE_TOKENS.has(token)),
    isArrayDbType: dbType.includes("array") || dbType.startsWith("_") || dbType.endsWith("[]"),
    isBoolDbType: dbType.includes("bool"),
    isJsonDbType: dbType.includes("json"),
    isMoneyDbType: dbType.includes("money"),
    isTimestampDbType: dbType.includes("timestamptz") || dbType.includes("timestamp"),
    isDateDbType: dbType.includes("date") && !dbType.includes("timestamp"),
    isTimeDbType: dbType.includes("time") && !dbType.includes("timestamp") && !dbType.includes("date"),
    isTstzRangeDbType: dbType.includes("tstzrange"),
    isUuidDbType: dbType.includes("uuid"),
    isHstoreDbType: dbType.includes("hstore"),
    isCharDbType: dbType.includes("char") || dbType.includes("varying"),
    isTextDbType: dbType.includes("text"),
    isClobDbType: dbType.includes("clob"),
  };

  columnMetaCache.set(column, parsed);
  return parsed;
}

// ============================================================================
// Cell Builder Types
// ============================================================================

type CellBuilder = (
  rawValue: unknown,
  value: CellValue | null | undefined,
  column: GridColumnV2,
  meta: ParsedColumnMeta,
  readOnly: boolean,
) => GridCell;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper to cache cell results and apply read-only flags
 */
function cacheAndReturn(
  value: CellValue | null | undefined,
  columnId: string,
  readOnly: boolean,
  result: GridCell,
): GridCell {
  const finalized =
    readOnly && (result.allowOverlay || (result as any).readonly !== true)
      ? { ...result, allowOverlay: false, readonly: true } as GridCell
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

  if (process.env.NODE_ENV === "development") {
    cacheMisses++;
  }

  return finalized;
}

// ============================================================================
// Cell Builders (organized by type)
// ============================================================================

const buildEnumCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const enumValue = rawValue === null || rawValue === undefined ? null : String(rawValue);

  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "enum-cell",
      value: enumValue,
      allowedValues: column.meta!.enum_values,
      nullable: Boolean((column.meta as { nullable?: boolean } | null)?.nullable),
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: enumValue ?? "NULL",
    allowOverlay: true,
    readonly: false,
    contentAlign: "left",
  });
};

const buildBooleanCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  let boolValue: boolean | null = null;

  if (rawValue === null || rawValue === undefined) {
    boolValue = null;
  } else if (typeof rawValue === "boolean") {
    boolValue = rawValue;
  } else if (typeof rawValue === "string") {
    const lowerValue = rawValue.toLowerCase();
    if (lowerValue === "true" || lowerValue === "t" || lowerValue === "1") {
      boolValue = true;
    } else if (lowerValue === "false" || lowerValue === "f" || lowerValue === "0") {
      boolValue = false;
    }
  } else if (typeof rawValue === "number") {
    boolValue = rawValue !== 0;
  }

  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "boolean-cell",
      value: boolValue,
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: boolValue === null ? "NULL" : String(boolValue),
    allowOverlay: true,
    readonly: false,
    contentAlign: "center",
  });
};

const buildMoneyCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
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
};

const buildNumberCell: CellBuilder = (rawValue, value, column, meta, readOnly) => {
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
      dbType: meta.dbType,
      precision: column.meta?.precision,
      scale: column.meta?.scale,
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
    },
    copyData: numericString ?? "NULL",
    allowOverlay: true,
    readonly: false,
    contentAlign: "right",
  });
};

const buildJsonCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
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
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: jsonString ?? "NULL",
    allowOverlay: true,
    readonly: false,
  });
};

const buildHstoreCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const hstoreString = coerceToHstoreString(rawValue);

  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "hstore-cell",
      value: hstoreString,
      nullable: Boolean(column.meta?.nullable),
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: hstoreString ?? "NULL",
    allowOverlay: true,
    readonly: false,
    contentAlign: "left",
    themeOverride: {
      baseFontStyle: "400 11px monospace",
    },
  });
};

const buildArrayCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
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
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: inline ?? "NULL",
    allowOverlay: true,
    readonly: false,
    contentAlign: "left",
    themeOverride: {
      baseFontStyle: "400 11px monospace",
    },
  });
};

const buildTimestampCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const v = rawValue == null ? null : String(rawValue);
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "datetime-cell",
      value: v,
      nullable: Boolean(column.meta?.nullable),
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: v ?? "NULL",
    allowOverlay: true,
    readonly: false,
  });
};

const buildTstzRangeCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const v = rawValue == null ? null : String(rawValue);
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "tstzrange-cell",
      value: v,
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: v ?? "",
    allowOverlay: true,
    readonly: false,
  });
};

const buildDateCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const v = rawValue == null ? null : String(rawValue);
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "date-cell",
      value: v,
      nullable: Boolean(column.meta?.nullable),
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: v ?? "NULL",
    allowOverlay: true,
    readonly: false,
  });
};

const buildTimeCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const v = rawValue == null ? null : String(rawValue);
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "time-cell",
      value: v,
      nullable: Boolean(column.meta?.nullable),
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: v ?? "NULL",
    allowOverlay: true,
    readonly: false,
  });
};

const buildUuidCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const uuidString = rawValue == null ? null : String(rawValue);
  const isValid = uuidString ? UUID_REGEX.test(uuidString) : true;

  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "uuid-cell",
      value: uuidString,
      nullable: Boolean(column.meta?.nullable),
      isValid,
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: uuidString ?? "NULL",
    allowOverlay: true,
    readonly: false,
  });
};

const buildReferenceCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const metaWithFk = column.meta as {
    fk_reference?: {
      referenced_schema: string;
      referenced_table: string;
      referenced_column: string;
    };
  } | null | undefined;
  const fkRef = metaWithFk?.fk_reference;

  const refValue = rawValue == null ? null : rawValue;

  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "reference-cell",
      value: refValue as string | number | null,
      nullable: column.meta!.nullable,
      fkReference: {
        schema: fkRef!.referenced_schema,
        table: fkRef!.referenced_table,
        column: fkRef!.referenced_column,
      },
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: refValue ? String(refValue) : "NULL",
    allowOverlay: true,
    readonly: false,
  });
};

const buildTextSingleLineCell: CellBuilder = (rawValue, value, column, meta, readOnly) => {
  const textValue = rawValue == null ? null : String(rawValue);
  const metaWithMaxLen = column.meta as { character_maximum_length?: number | null } | null | undefined;
  const maxLength = metaWithMaxLen?.character_maximum_length;

  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "text-single-cell",
      value: textValue,
      nullable: column.meta ? column.meta.nullable : false,
      maxLength: maxLength ?? undefined,
      columnName: column.title || column.id,
      isPrimaryKey: column.meta?.is_pk ?? false,
      dbType: column.meta?.db_type ?? meta.dbType,
    },
    copyData: textValue ?? "NULL",
    allowOverlay: true,
    readonly: false,
  });
};

const buildTextMultiLineCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const textValue = rawValue == null ? null : String(rawValue);

  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "text-multi-cell",
      value: textValue,
      nullable: column.meta ? column.meta.nullable : false,
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: textValue !== null ? textValue : "NULL",
    allowOverlay: true,
    readonly: false,
  });
};

const buildNullCell: CellBuilder = (_rawValue, value, column, meta, readOnly) => {
  const isNumericColumn = meta.isNumericDbType || meta.isMoneyDbType;

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
};

const buildDefaultTextCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const text = String(rawValue);
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Text,
    data: text,
    displayData: text,
    allowOverlay: true,
    readonly: false,
  });
};

// ============================================================================
// Main Builder Function
// ============================================================================

/**
 * Build a GridCell for V2 with optimized caching and type routing.
 * 
 * Performance optimizations:
 * - WeakMap cache keyed by CellValue object identity
 * - Column metadata parsed once per column object
 * - Early cache lookup before any processing
 * - Type-specific builders to avoid long if-else chains
 */
export function buildGridCellV2(opts: {
  value: CellValue | null | undefined;
  column: GridColumnV2;
  readOnly?: boolean;
}): GridCell {
  const { value, column, readOnly = false } = opts;
  const cacheKey = readOnly ? `${column.id}:ro` : `${column.id}:rw`;

  // Try to get from cache first (fast path)
  if (value && typeof value === "object") {
    const columnCache = cellCache.get(value);
    const cached = columnCache?.get(cacheKey);
    if (cached) {
      if (process.env.NODE_ENV === "development") {
        cacheHits++;
      }
      return cached;
    }
  }

  const rawValue = value?.value;
  
  // Use cached parsed metadata to avoid re-parsing db_type on every cell render
  const meta = getOrParseColumnMeta(column);

  // Route to appropriate builder based on type (ordered by frequency)
  
  // Enum cells (check first due to explicit enum_values)
  if (column.meta?.enum_values && column.meta.enum_values.length > 0) {
    return buildEnumCell(rawValue, value, column, meta, readOnly);
  }

  // Boolean cells
  if (meta.isBoolDbType || typeof rawValue === "boolean") {
    return buildBooleanCell(rawValue, value, column, meta, readOnly);
  }

  // Money cells
  if (meta.isMoneyDbType) {
    return buildMoneyCell(rawValue, value, column, meta, readOnly);
  }

  // Number cells
  if (meta.isNumericDbType || typeof rawValue === "number" || typeof rawValue === "bigint") {
    return buildNumberCell(rawValue, value, column, meta, readOnly);
  }

  // JSON cells
  if (meta.isJsonDbType) {
    return buildJsonCell(rawValue, value, column, meta, readOnly);
  }

  // HStore cells
  if (meta.isHstoreDbType) {
    return buildHstoreCell(rawValue, value, column, meta, readOnly);
  }

  // Array cells
  if (meta.isArrayDbType || Array.isArray(rawValue)) {
    return buildArrayCell(rawValue, value, column, meta, readOnly);
  }

  // Timestamp cells (check before date/time)
  if (meta.isTimestampDbType) {
    return buildTimestampCell(rawValue, value, column, meta, readOnly);
  }

  // TstzRange cells (PostgreSQL range type)
  if (meta.isTstzRangeDbType) {
    return buildTstzRangeCell(rawValue, value, column, meta, readOnly);
  }

  // Date cells
  if (meta.isDateDbType) {
    return buildDateCell(rawValue, value, column, meta, readOnly);
  }

  // Time cells
  if (meta.isTimeDbType) {
    return buildTimeCell(rawValue, value, column, meta, readOnly);
  }

  // UUID cells
  if (meta.isUuidDbType) {
    return buildUuidCell(rawValue, value, column, meta, readOnly);
  }

  // Reference/FK cells
  const metaWithFk = column.meta as { fk_reference?: object } | null | undefined;
  if (column.meta?.is_fk && metaWithFk?.fk_reference) {
    return buildReferenceCell(rawValue, value, column, meta, readOnly);
  }

  // Text cells
  const textValue = rawValue == null ? null : String(rawValue);
  const textLength = textValue ? textValue.length : 0;

  // Single-line text (char, varchar with length < 200)
  if (meta.isCharDbType && textLength < 200) {
    return buildTextSingleLineCell(rawValue, value, column, meta, readOnly);
  }

  // Multi-line text (text, clob, or long content)
  if (meta.isTextDbType || meta.isClobDbType || textLength >= 200) {
    return buildTextMultiLineCell(rawValue, value, column, meta, readOnly);
  }

  // NULL values
  if (rawValue === null || rawValue === undefined) {
    return buildNullCell(rawValue, value, column, meta, readOnly);
  }

  // Default: plain text cell
  return buildDefaultTextCell(rawValue, value, column, meta, readOnly);
}

// ============================================================================
// Development Utilities
// ============================================================================

/**
 * Get cache statistics (development only)
 */
export function getCellFactoryStats(): { hits: number; misses: number; hitRate: string } {
  const total = cacheHits + cacheMisses;
  const hitRate = total > 0 ? ((cacheHits / total) * 100).toFixed(1) : "0";
  return { hits: cacheHits, misses: cacheMisses, hitRate: `${hitRate}%` };
}

/**
 * Reset cache statistics (development only)
 */
export function resetCellFactoryStats(): void {
  cacheHits = 0;
  cacheMisses = 0;
}

// Development helper
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as any).__cellFactoryStats = getCellFactoryStats;
  (window as any).__resetCellFactoryStats = resetCellFactoryStats;
}
