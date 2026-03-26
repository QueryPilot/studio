import { GridCellKind, type GridCell } from "@glideapps/glide-data-grid";
import type { CellValue } from "@/types";
import type { GridColumnV2 } from "../types";
import { computeArrayStringsFromRaw } from "../utils/arrayFormat";
import { coerceToHstoreString } from "../renderers/HStoreCell/hstoreFormat";
import { base64ToBytes, parseHstoreFromBytes, formatHstore, isValidBase64 } from "../renderers/ByteaCell/utils";
import {
  cacheAndReturn as sharedCacheAndReturn,
  tryGetCachedCell,
  isValidUuidString,
  getCellFactoryStats,
  resetCellFactoryStats,
} from "./cellFactoryShared";

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
  // New type flags for extended support
  isInetDbType: boolean;
  isCidrDbType: boolean;
  isMacAddrDbType: boolean;
  isRangeDbType: boolean;
  isIntervalDbType: boolean;
  isXmlDbType: boolean;
  isBitDbType: boolean;
  isByteaDbType: boolean;
  isGeometryDbType: boolean;
}

const columnMetaCache = new WeakMap<GridColumnV2, ParsedColumnMeta>();

function getOrParseColumnMeta(column: GridColumnV2): ParsedColumnMeta {
  const cached = columnMetaCache.get(column);
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
    isJsonDbType: dbType.includes("json") || dbType.includes("struct") || dbType.includes("map"),
    isMoneyDbType: dbType.includes("money"),
    isTimestampDbType: dbType.includes("timestamptz") || dbType.includes("timestamp"),
    isDateDbType: dbType.includes("date") && !dbType.includes("timestamp") && !dbType.includes("daterange"),
    isTimeDbType: dbType.includes("time") && !dbType.includes("timestamp") && !dbType.includes("date"),
    isTstzRangeDbType: dbType.includes("tstzrange"),
    isUuidDbType: dbType.includes("uuid"),
    isHstoreDbType: dbType.includes("hstore"),
    isCharDbType: dbType.includes("char") || dbType.includes("varying"),
    isTextDbType: dbType.includes("text") && !dbType.includes("tsvector"),
    isClobDbType: dbType.includes("clob"),
    // New type flags for extended support
    isInetDbType: dbType === "inet",
    isCidrDbType: dbType === "cidr",
    isMacAddrDbType: dbType.includes("macaddr"),
    isRangeDbType: (dbType.includes("range") && !dbType.includes("tstzrange")) || 
      dbType === "int4range" || dbType === "int8range" || dbType === "numrange" || 
      dbType === "daterange" || dbType === "tsrange",
    isIntervalDbType: dbType === "interval",
    isXmlDbType: dbType === "xml",
    isBitDbType: dbType === "bit" || dbType === "varbit" || dbType.startsWith("bit("),
    isByteaDbType: dbType === "bytea",
    isGeometryDbType: dbType === "geometry" || dbType === "geography" || 
      dbType.includes("geometry") || dbType.includes("geography"),
  };

  columnMetaCache.set(column, parsed);
  return parsed;
}

// ============================================================================
// Cell Builder Types
// ============================================================================

export interface ConnectionContext {
  connectionId?: string;
  database?: string;
  schema?: string;
  table?: string;
}

type CellBuilder = (
  rawValue: unknown,
  value: CellValue | null | undefined,
  column: GridColumnV2,
  meta: ParsedColumnMeta,
  readOnly: boolean,
  embeddedValue?: string | null,
  connectionContext?: ConnectionContext,
) => GridCell;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper to cache cell results and apply read-only flags
 * Delegates to shared cache infrastructure
 */
function cacheAndReturn(
  value: CellValue | null | undefined,
  columnId: string,
  readOnly: boolean,
  result: GridCell,
): GridCell {
  const cacheKey = readOnly ? `${columnId}:ro` : `${columnId}:rw`;
  return sharedCacheAndReturn(value, cacheKey, readOnly, result);
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

const buildMoneyCell: CellBuilder = (rawValue, value, column, meta, readOnly) => {
  // Use number-cell for money type to enable editing with proper numeric validation
  const numericString =
    rawValue === null || rawValue === undefined
      ? null
      : typeof rawValue === "number"
      ? rawValue.toString()
      : String(rawValue);

  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "number-cell",
      value: numericString,
      nullable: Boolean(column.meta?.nullable),
      dbType: meta.dbType,
      precision: column.meta?.precision,
      scale: column.meta?.scale ?? 2, // Money typically has 2 decimal places
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
    },
    copyData: numericString ?? "NULL",
    allowOverlay: true,
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
  let hstoreString: string | null;

  if (rawValue === null || rawValue === undefined) {
    hstoreString = null;
  } else if (typeof rawValue === 'string' && isValidBase64(rawValue)) {
    try {
      const bytes = base64ToBytes(rawValue);
      const hstore = parseHstoreFromBytes(bytes);
      hstoreString = formatHstore(hstore);
    } catch {
      hstoreString = coerceToHstoreString(rawValue);
    }
  } else {
    hstoreString = coerceToHstoreString(rawValue);
  }

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
  const isValid = uuidString ? isValidUuidString(uuidString) : true;

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

const buildReferenceCell: CellBuilder = (rawValue, value, column, _meta, readOnly, embeddedValue, connectionContext) => {
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
      embeddedValue,
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
      // Connection context for FK lookup queries in editor
      connectionId: connectionContext?.connectionId,
      database: connectionContext?.database,
      sourceSchema: connectionContext?.schema,
      sourceTable: connectionContext?.table,
    },
    copyData: refValue ? String(refValue) : "NULL",
    allowOverlay: true,
    readonly: false,
  });
};

// Network type builders (INET, CIDR, MACADDR)
const buildInetCell: CellBuilder = (rawValue, value, column, meta, readOnly) => {
  const v = rawValue == null ? null : String(rawValue);
  const isCidr = meta.isCidrDbType;
  
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: isCidr ? "cidr-cell" : "inet-cell",
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

const buildMacAddrCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const v = rawValue == null ? null : String(rawValue);
  
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "macaddr-cell",
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

// Range type builder (INT4RANGE, INT8RANGE, NUMRANGE, DATERANGE, TSRANGE)
const buildRangeCell: CellBuilder = (rawValue, value, column, meta, readOnly) => {
  const v = rawValue == null ? null : String(rawValue);
  
  // Determine range kind based on db_type
  let kind: string = "int4range-cell";
  if (meta.dbType.includes("int8")) kind = "int8range-cell";
  else if (meta.dbType.includes("num")) kind = "numrange-cell";
  else if (meta.dbType.includes("date")) kind = "daterange-cell";
  else if (meta.dbType.includes("ts") && !meta.dbType.includes("tstz")) kind = "tsrange-cell";
  
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind,
      value: v,
      nullable: Boolean(column.meta?.nullable),
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
      precision: column.meta?.precision,
      scale: column.meta?.scale,
    },
    copyData: v ?? "NULL",
    allowOverlay: true,
    readonly: false,
  });
};

// Interval type builder
const buildIntervalCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const v = rawValue == null ? null : String(rawValue);
  
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "interval-cell",
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

// XML type builder
const buildXmlCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  const v = rawValue == null ? null : String(rawValue);
  
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "xml-cell",
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

// Bit string type builder (BIT, VARBIT)
const buildBitCell: CellBuilder = (rawValue, value, column, meta, readOnly) => {
  const v = rawValue == null ? null : String(rawValue);
  
  // Extract length from db_type like "bit(8)"
  const lengthMatch = meta.dbType.match(/bit\((\d+)\)/);
  const length = lengthMatch?.[1] ? parseInt(lengthMatch[1], 10) : undefined;
  
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: meta.dbType.includes("var") ? "varbit-cell" : "bit-cell",
      value: v,
      nullable: Boolean(column.meta?.nullable),
      length,
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: v ? `B'${v}'` : "NULL",
    allowOverlay: true,
    readonly: false,
  });
};

// Bytea (binary) type builder
const buildByteaCell: CellBuilder = (rawValue, value, column, _meta, readOnly) => {
  // Bytea comes as base64 encoded string from backend
  const v = rawValue == null ? null : String(rawValue);
  
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: "bytea-cell",
      value: v,
      nullable: Boolean(column.meta?.nullable),
      columnName: column.name,
      isPrimaryKey: Boolean(column.meta?.is_pk),
      dbType: column.meta?.db_type ?? column.type,
    },
    copyData: v ? "[BINARY]" : "NULL",
    allowOverlay: true,
    readonly: false,
  });
};

// Geometry/Geography type builder (PostGIS)
const buildGeometryCell: CellBuilder = (rawValue, value, column, meta, readOnly) => {
  const v = rawValue == null ? null : String(rawValue);
  
  return cacheAndReturn(value, column.id, readOnly, {
    kind: GridCellKind.Custom,
    data: {
      kind: meta.dbType.includes("geography") ? "geography-cell" : "geometry-cell",
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

const buildDefaultTextCell: CellBuilder = (rawValue, value, column, meta, readOnly) => {
  const textValue = String(rawValue);
  const textLength = textValue.length;

  // Use text-single-cell for short text, text-multi-cell for longer text
  // This ensures proper ellipsis/truncation via our custom renderers
  if (textLength < 200) {
    return buildTextSingleLineCell(rawValue, value, column, meta, readOnly);
  }
  return buildTextMultiLineCell(rawValue, value, column, meta, readOnly);
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
  /** Embedded FK display value extracted from row data (e.g., "john@email.com") */
  embeddedValue?: string | null;
  /** Connection context for FK editor queries */
  connectionContext?: ConnectionContext;
}): GridCell {
  const { value, column, readOnly = false, embeddedValue, connectionContext } = opts;
  
  // Force readOnly for computed or virtual columns (MSSQL computed, MySQL/MariaDB virtual)
  const isComputedOrVirtual = column.meta?.is_computed || column.meta?.is_virtual;
  const effectiveReadOnly = readOnly || isComputedOrVirtual || false;
  
  // Include embeddedValue in cache key to ensure cells with different embedded values are cached separately
  const embeddedSuffix = embeddedValue ? `:e:${embeddedValue}` : "";
  const cacheKey = effectiveReadOnly ? `${column.id}:ro${embeddedSuffix}` : `${column.id}:rw${embeddedSuffix}`;

  // Try to get from cache first (fast path)
  const cached = tryGetCachedCell(value, cacheKey);
  if (cached) {
    return cached;
  }

  const rawValue = value?.value;
  
  // Use cached parsed metadata to avoid re-parsing db_type on every cell render
  const meta = getOrParseColumnMeta(column);

  // Route to appropriate builder based on type (ordered by frequency)
  
  // Enum cells (check first due to explicit enum_values)
  if (column.meta?.enum_values && column.meta.enum_values.length > 0) {
    return buildEnumCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Reference/FK cells - check early to handle FK columns that are numeric types
  const metaWithFk = column.meta as { fk_reference?: object } | null | undefined;
  if (column.meta?.is_fk && metaWithFk?.fk_reference) {
    return buildReferenceCell(rawValue, value, column, meta, effectiveReadOnly, embeddedValue, connectionContext);
  }

  // Boolean cells
  if (meta.isBoolDbType || typeof rawValue === "boolean") {
    return buildBooleanCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Money cells
  if (meta.isMoneyDbType) {
    return buildMoneyCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Number cells
  if (meta.isNumericDbType || typeof rawValue === "number" || typeof rawValue === "bigint") {
    return buildNumberCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // JSON cells
  if (meta.isJsonDbType) {
    return buildJsonCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // HStore cells
  if (meta.isHstoreDbType) {
    return buildHstoreCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Array cells
  if (meta.isArrayDbType || Array.isArray(rawValue)) {
    return buildArrayCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Timestamp cells (check before date/time)
  if (meta.isTimestampDbType) {
    return buildTimestampCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // TstzRange cells (PostgreSQL range type)
  if (meta.isTstzRangeDbType) {
    return buildTstzRangeCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Date cells
  if (meta.isDateDbType) {
    return buildDateCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Time cells
  if (meta.isTimeDbType) {
    return buildTimeCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // UUID cells
  if (meta.isUuidDbType) {
    return buildUuidCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Network types (INET, CIDR, MACADDR)
  if (meta.isInetDbType || meta.isCidrDbType) {
    return buildInetCell(rawValue, value, column, meta, effectiveReadOnly);
  }
  if (meta.isMacAddrDbType) {
    return buildMacAddrCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Range types (INT4RANGE, INT8RANGE, NUMRANGE, DATERANGE, TSRANGE)
  if (meta.isRangeDbType) {
    return buildRangeCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Interval type
  if (meta.isIntervalDbType) {
    return buildIntervalCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // XML type
  if (meta.isXmlDbType) {
    return buildXmlCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Bit string types (BIT, VARBIT)
  if (meta.isBitDbType) {
    return buildBitCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Bytea (binary) type
  if (meta.isByteaDbType) {
    return buildByteaCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Geometry/Geography types (PostGIS)
  if (meta.isGeometryDbType) {
    return buildGeometryCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Object values that weren't caught by type detection (e.g. DuckDB STRUCT/MAP/LIST)
  if (rawValue !== null && typeof rawValue === "object") {
    return buildJsonCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Text cells
  const textValue = rawValue == null ? null : String(rawValue);
  const textLength = textValue ? textValue.length : 0;

  // Single-line text (char, varchar with length < 200)
  if (meta.isCharDbType && textLength < 200) {
    return buildTextSingleLineCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Multi-line text (text, clob, or long content)
  if (meta.isTextDbType || meta.isClobDbType || textLength >= 200) {
    return buildTextMultiLineCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // NULL values
  if (rawValue === null || rawValue === undefined) {
    return buildNullCell(rawValue, value, column, meta, effectiveReadOnly);
  }

  // Default: plain text cell
  return buildDefaultTextCell(rawValue, value, column, meta, effectiveReadOnly);
}

// ============================================================================
// Development Utilities (re-exported from shared)
// ============================================================================

export { getCellFactoryStats, resetCellFactoryStats };
