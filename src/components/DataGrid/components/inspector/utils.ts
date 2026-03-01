import type { GridColumnV2, GridRowModel } from "../../types";
import type { InspectorDocument, MergedFieldValue } from "./types";

/**
 * Unwraps cell wrapper objects that store the value in a `{ value: T }` shape.
 * Returns the raw value if it's not wrapped.
 */
export function extractCellValue(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "value" in (value as Record<string, unknown>)
  ) {
    return (value as { value?: unknown }).value;
  }
  return value;
}

/**
 * Resolves a human-readable display label for a column.
 *
 * Fallback chain: title -> name -> meta.name -> field.
 * Generic "col_N" patterns are skipped in favour of more descriptive names
 * when available.
 */
export function getColumnLabel(column: GridColumnV2): string {
  const title = column.title.trim();
  if (title && !/^col_\d+$/i.test(title)) return title;

  // Check meta.name before column.name so descriptive DB names from
  // introspection are preferred over generic "col_N" patterns.
  const metaName = column.meta?.name.trim();
  if (metaName && !/^col_\d+$/i.test(metaName)) return metaName;

  const name = column.name.trim();
  if (name && !/^col_\d+$/i.test(name)) return name;

  if (title) return title;
  if (metaName) return metaName;
  if (name) return name;
  return column.field;
}

/**
 * Converts a grid row model into a flat key-value document using column labels.
 *
 * When duplicate labels exist (e.g. from JOINs), subsequent occurrences are
 * disambiguated with a numeric suffix: `label`, `label (2)`, `label (3)`, ...
 */
export function rowToDocument(
  row: GridRowModel,
  columns: GridColumnV2[],
): InspectorDocument {
  const doc: InspectorDocument = {};
  const usedLabels = new Map<string, number>();

  for (const column of columns) {
    const baseLabel = getColumnLabel(column);
    const duplicateCount = usedLabels.get(baseLabel) ?? 0;
    usedLabels.set(baseLabel, duplicateCount + 1);
    const label =
      duplicateCount === 0 ? baseLabel : `${baseLabel} (${duplicateCount + 1})`;
    doc[label] = extractCellValue(row[column.field]);
  }

  return doc;
}

/**
 * Builds a mapping from display label → column field key.
 *
 * This is the reverse of what `rowToDocument` does: `rowToDocument` maps
 * field → label, and this function maps label → field. Used by the panel
 * shell to translate tree-view edit callbacks (which use labels) back to
 * column field keys that the CRUD pipeline understands.
 */
export function buildLabelToFieldMap(
  columns: GridColumnV2[],
): Map<string, string> {
  const map = new Map<string, string>();
  const usedLabels = new Map<string, number>();

  for (const column of columns) {
    const baseLabel = getColumnLabel(column);
    const duplicateCount = usedLabels.get(baseLabel) ?? 0;
    usedLabels.set(baseLabel, duplicateCount + 1);
    const label =
      duplicateCount === 0 ? baseLabel : `${baseLabel} (${duplicateCount + 1})`;
    map.set(label, column.field);
  }

  return map;
}

/**
 * Builds a mapping from display label → column data type string.
 *
 * Prefers the original database type from `meta.db_type` (e.g. "VARCHAR(255)"),
 * falling back to the generic `column.type` (e.g. "string").
 */
export function buildLabelToDataTypeMap(
  columns: GridColumnV2[],
): Map<string, string> {
  const map = new Map<string, string>();
  const usedLabels = new Map<string, number>();

  for (const column of columns) {
    const baseLabel = getColumnLabel(column);
    const duplicateCount = usedLabels.get(baseLabel) ?? 0;
    usedLabels.set(baseLabel, duplicateCount + 1);
    const label =
      duplicateCount === 0 ? baseLabel : `${baseLabel} (${duplicateCount + 1})`;
    const dataType = column.meta?.db_type || column.type;
    if (dataType) {
      map.set(label, dataType);
    }
  }

  return map;
}

/**
 * Converts an array of grid row models to inspector documents.
 */
export function rowsToDocuments(
  rows: GridRowModel[],
  columns: GridColumnV2[],
): InspectorDocument[] {
  return rows.map((row) => rowToDocument(row, columns));
}

/**
 * Merges a single field's values across multiple documents.
 *
 * Returns `{ kind: "same", value }` when every value is identical (by JSON
 * equality), or `{ kind: "multiple", values, distinctValues }` when values
 * differ.
 */
export function mergeFieldValues(values: unknown[]): MergedFieldValue {
  if (values.length === 0) {
    return { kind: "same", value: undefined };
  }

  const serialized = values.map((v) => {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  });

  const allSame = serialized.every((s) => s === serialized[0]);

  if (allSame) {
    return { kind: "same", value: values[0] };
  }

  const seen = new Set<string>();
  const distinctValues: unknown[] = [];
  for (const [i, key] of serialized.entries()) {
    if (!seen.has(key)) {
      seen.add(key);
      distinctValues.push(values[i]);
    }
  }

  return { kind: "multiple", values, distinctValues };
}

/**
 * Computes the set of top-level field names that differ between two documents.
 *
 * Uses JSON serialisation for deep equality comparison.
 * Note: comparison is shallow at the document key level. Two records where
 * only `address.city` differs will surface "address" as a diff field, not
 * "address.city". This is intentional — DiffView renders full value badges.
 */
export function computeDiffFields(
  reference: InspectorDocument,
  other: InspectorDocument,
): Set<string> {
  const allKeys = new Set([
    ...Object.keys(reference),
    ...Object.keys(other),
  ]);
  const diffFields = new Set<string>();

  for (const key of allKeys) {
    const refVal = reference[key];
    const otherVal = other[key];

    let refSerialized: string;
    let otherSerialized: string;
    try {
      refSerialized = JSON.stringify(refVal);
    } catch {
      refSerialized = String(refVal);
    }
    try {
      otherSerialized = JSON.stringify(otherVal);
    } catch {
      otherSerialized = String(otherVal);
    }

    if (refSerialized !== otherSerialized) {
      diffFields.add(key);
    }
  }

  return diffFields;
}

/**
 * Converts any value into a string representation suitable for searching.
 *
 * Callers should apply their own case normalisation for case-insensitive matching.
 *
 * - `null` / `undefined` -> empty string
 * - Primitives -> `String(value)`
 * - Objects / arrays -> `JSON.stringify(value)`
 */
export function toSearchableText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

/**
 * Formats a value for display in the inspector.
 *
 * - Strings are wrapped in double quotes
 * - `null` and `undefined` are shown as literal text
 * - Objects / arrays are JSON-serialised with 2-space indentation
 * - Everything else uses `String(value)`
 */
export function formatValueForDisplay(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Returns a value formatted for pre-filling inline edit inputs.
 *
 * Unlike `formatValueForDisplay`, strings are NOT wrapped in double quotes
 * so the user edits the raw content directly (e.g. `hello` not `"hello"`).
 * Non-string values use the same format as `formatValueForDisplay`.
 */
export function rawValueForEdit(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}
