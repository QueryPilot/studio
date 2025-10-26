/**
 * Diff Computation Utilities
 *
 * Deep comparison and diff tracking for table editing operations.
 */

import type { CellValue } from "@/types/cellValue";
import type { ColumnMeta } from "@/types/database";

// ============================================================================
// Types
// ============================================================================

export interface ColumnDiff {
  name?: { from: string; to: string };
  db_type?: { from: string; to: string };
  nullable?: { from: boolean; to: boolean };
  default?: { from: string | null; to: string | null };
  is_pk?: { from: boolean; to: boolean };
  is_fk?: { from: boolean; to: boolean };
  check_constraint?: { from: string | null; to: string | null };
  foreign_key_ref?: { from: any; to: any };
  comment?: { from: string | null; to: string | null };
  enum_values?: { from: string[] | undefined; to: string[] | undefined };
  type_category?: { from: string | undefined; to: string | undefined };
}

export interface RowDiff {
  changedCells: Map<string, CellDiff>;
  hasChanges: boolean;
}

export interface CellDiff {
  columnId: string;
  from: CellValue | null;
  to: CellValue | null;
  valueChanged: boolean;
}

export interface IndexDiff {
  name?: { from: string; to: string };
  columns?: { from: string[]; to: string[] };
  unique?: { from: boolean; to: boolean };
  type?: { from: string; to: string };
  condition?: { from: string | undefined; to: string | undefined };
}

export interface TriggerDiff {
  name?: { from: string; to: string };
  event?: { from: string; to: string };
  timing?: { from: string; to: string };
  level?: { from: string; to: string };
  enabled?: { from: boolean; to: boolean };
  function?: { from: string; to: string };
  condition?: { from: string | undefined; to: string | undefined };
}

// ============================================================================
// Deep Equality Helpers
// ============================================================================

/**
 * Deep equality check for nested objects
 */
export function deepEqual(a: any, b: any): boolean {
  // Same reference
  if (a === b) return true;

  // Null or undefined
  if (a == null || b == null) return a == b;

  // Different types
  if (typeof a !== typeof b) return false;

  // NaN check
  if (typeof a === "number" && isNaN(a) && isNaN(b)) return true;

  // Date check
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // Array check
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, idx) => deepEqual(val, b[idx]));
  }

  // Object check
  if (typeof a === "object" && typeof b === "object") {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) => deepEqual(a[key], b[key]));
  }

  // Primitive comparison
  return a === b;
}

/**
 * Check if two cell values are equal (enhanced from TableDataGridV2)
 */
export function areCellValuesEqual(
  left: CellValue | null | undefined,
  right: CellValue | null | undefined,
): boolean {
  const leftValue = left?.value ?? null;
  const rightValue = right?.value ?? null;

  // Same reference or both null/undefined
  if (leftValue === rightValue) {
    return true;
  }

  // One is null, other isn't
  if (leftValue == null || rightValue == null) {
    return leftValue == null && rightValue == null;
  }

  // Both NaN
  if (
    typeof leftValue === "number" &&
    typeof rightValue === "number" &&
    Number.isNaN(leftValue) &&
    Number.isNaN(rightValue)
  ) {
    return true;
  }

  // Object comparison (JSON, HSTORE, arrays, etc.)
  if (
    typeof leftValue === "object" &&
    typeof rightValue === "object" &&
    leftValue !== null &&
    rightValue !== null
  ) {
    return deepEqual(leftValue, rightValue);
  }

  // Primitive comparison
  return false;
}

// ============================================================================
// Column Diff
// ============================================================================

/**
 * Compute differences between original and draft column
 */
export function computeColumnDiff(
  original: Partial<ColumnMeta>,
  draft: Partial<ColumnMeta>,
): { diff: ColumnDiff; changed: string[] } {
  const diff: ColumnDiff = {};
  const changed: string[] = [];

  // Name
  if (original.name !== draft.name && draft.name !== undefined) {
    diff.name = { from: original.name || "", to: draft.name };
    changed.push("name");
  }

  // Type
  if (original.db_type !== draft.db_type && draft.db_type !== undefined) {
    diff.db_type = { from: original.db_type || "", to: draft.db_type };
    changed.push("db_type");
  }

  // Nullable
  if (original.nullable !== draft.nullable && draft.nullable !== undefined) {
    diff.nullable = { from: original.nullable ?? true, to: draft.nullable };
    changed.push("nullable");
  }

  // Default
  if (original.default !== draft.default && draft.default !== undefined) {
    diff.default = { from: original.default ?? null, to: draft.default };
    changed.push("default");
  }

  // Primary key
  if (original.is_pk !== draft.is_pk && draft.is_pk !== undefined) {
    diff.is_pk = { from: original.is_pk ?? false, to: draft.is_pk };
    changed.push("is_pk");
  }

  // Foreign key
  if (original.is_fk !== draft.is_fk && draft.is_fk !== undefined) {
    diff.is_fk = { from: original.is_fk ?? false, to: draft.is_fk };
    changed.push("is_fk");
  }

  // Comment
  if (original.comment !== draft.comment && draft.comment !== undefined) {
    diff.comment = { from: original.comment ?? null, to: draft.comment };
    changed.push("comment");
  }

  // Enum values
  if (
    !deepEqual(original.enum_values, draft.enum_values) &&
    draft.enum_values !== undefined
  ) {
    diff.enum_values = { from: original.enum_values, to: draft.enum_values };
    changed.push("enum_values");
  }

  // Type category
  if (
    original.type_category !== draft.type_category &&
    draft.type_category !== undefined
  ) {
    diff.type_category = {
      from: original.type_category,
      to: draft.type_category,
    };
    changed.push("type_category");
  }

  return { diff, changed };
}

/**
 * Check if column has any meaningful changes
 */
export function hasColumnChanges(
  original: Partial<ColumnMeta>,
  draft: Partial<ColumnMeta>,
): boolean {
  const { changed } = computeColumnDiff(original, draft);
  return changed.length > 0;
}

// ============================================================================
// Row & Cell Diff
// ============================================================================

/**
 * Compute differences between original and draft row
 */
export function computeRowDiff(
  original: Record<string, CellValue | null | undefined> | null,
  draft: Record<string, CellValue | null | undefined> | null,
  columns: ColumnMeta[],
): RowDiff {
  const changedCells = new Map<string, CellDiff>();

  // If both null, no changes
  if (!original && !draft) {
    return { changedCells, hasChanges: false };
  }

  // Check each column
  for (const column of columns) {
    const columnId = column.name;
    const originalCell = original?.[columnId];
    const draftCell = draft?.[columnId];

    if (!areCellValuesEqual(originalCell, draftCell)) {
      changedCells.set(columnId, {
        columnId,
        from: originalCell ?? null,
        to: draftCell ?? null,
        valueChanged: true,
      });
    }
  }

  return {
    changedCells,
    hasChanges: changedCells.size > 0,
  };
}

/**
 * Compute cell-level diff
 */
export function computeCellDiff(
  original: CellValue | null | undefined,
  draft: CellValue | null | undefined,
): CellDiff | null {
  if (areCellValuesEqual(original, draft)) {
    return null;
  }

  return {
    columnId: "", // Will be set by caller
    from: original ?? null,
    to: draft ?? null,
    valueChanged: true,
  };
}

// ============================================================================
// Index Diff
// ============================================================================

/**
 * Compute differences between original and draft index
 */
export function computeIndexDiff(
  original: {
    name: string;
    columns: string[];
    unique?: boolean;
    type?: string;
    condition?: string;
  },
  draft: {
    name: string;
    columns: string[];
    unique?: boolean;
    type?: string;
    condition?: string;
  },
): { diff: IndexDiff; changed: string[] } {
  const diff: IndexDiff = {};
  const changed: string[] = [];

  // Name
  if (original.name !== draft.name) {
    diff.name = { from: original.name, to: draft.name };
    changed.push("name");
  }

  // Columns
  if (!deepEqual(original.columns, draft.columns)) {
    diff.columns = { from: original.columns, to: draft.columns };
    changed.push("columns");
  }

  // Unique
  if (original.unique !== draft.unique) {
    diff.unique = { from: original.unique ?? false, to: draft.unique ?? false };
    changed.push("unique");
  }

  // Type
  if (original.type !== draft.type) {
    diff.type = { from: original.type || "", to: draft.type || "" };
    changed.push("type");
  }

  // Condition
  if (original.condition !== draft.condition) {
    diff.condition = { from: original.condition, to: draft.condition };
    changed.push("condition");
  }

  return { diff, changed };
}

/**
 * Check if index has any meaningful changes
 */
export function hasIndexChanges(
  original: {
    name: string;
    columns: string[];
    unique?: boolean;
    type?: string;
    condition?: string;
  },
  draft: {
    name: string;
    columns: string[];
    unique?: boolean;
    type?: string;
    condition?: string;
  },
): boolean {
  const { changed } = computeIndexDiff(original, draft);
  return changed.length > 0;
}

// ============================================================================
// Trigger Diff
// ============================================================================

/**
 * Compute differences between original and draft trigger
 */
export function computeTriggerDiff(
  original: {
    name: string;
    event: string;
    timing: string;
    level: string;
    enabled: boolean;
    function: string;
    condition?: string;
  },
  draft: {
    name: string;
    event: string;
    timing: string;
    level: string;
    enabled: boolean;
    function: string;
    condition?: string;
  },
): { diff: TriggerDiff; changed: string[] } {
  const diff: TriggerDiff = {};
  const changed: string[] = [];

  // Name
  if (original.name !== draft.name) {
    diff.name = { from: original.name, to: draft.name };
    changed.push("name");
  }

  // Event
  if (original.event !== draft.event) {
    diff.event = { from: original.event, to: draft.event };
    changed.push("event");
  }

  // Timing
  if (original.timing !== draft.timing) {
    diff.timing = { from: original.timing, to: draft.timing };
    changed.push("timing");
  }

  // Level
  if (original.level !== draft.level) {
    diff.level = { from: original.level, to: draft.level };
    changed.push("level");
  }

  // Enabled
  if (original.enabled !== draft.enabled) {
    diff.enabled = { from: original.enabled, to: draft.enabled };
    changed.push("enabled");
  }

  // Function
  if (original.function !== draft.function) {
    diff.function = { from: original.function, to: draft.function };
    changed.push("function");
  }

  // Condition
  if (original.condition !== draft.condition) {
    diff.condition = { from: original.condition, to: draft.condition };
    changed.push("condition");
  }

  return { diff, changed };
}

/**
 * Check if trigger has any meaningful changes
 */
export function hasTriggerChanges(
  original: {
    name: string;
    event: string;
    timing: string;
    level: string;
    enabled: boolean;
    function: string;
    condition?: string;
  },
  draft: {
    name: string;
    event: string;
    timing: string;
    level: string;
    enabled: boolean;
    function: string;
    condition?: string;
  },
): boolean {
  const { changed } = computeTriggerDiff(original, draft);
  return changed.length > 0;
}

// ============================================================================
// Generic Diff Helpers
// ============================================================================

/**
 * Get list of changed property keys from two objects
 */
export function getChangedKeys<T extends Record<string, any>>(
  original: T,
  draft: T,
  excludeKeys: string[] = [],
): string[] {
  const allKeys = new Set([...Object.keys(original), ...Object.keys(draft)]);
  const changed: string[] = [];

  for (const key of allKeys) {
    if (excludeKeys.includes(key)) continue;

    if (!deepEqual(original[key], draft[key])) {
      changed.push(key);
    }
  }

  return changed;
}

/**
 * Create a diff object with from/to structure
 */
export function createDiffEntry<T>(from: T, to: T): { from: T; to: T } {
  return { from, to };
}

/**
 * Check if a diff entry represents a change
 */
export function isDiffChanged<T>(
  diff: { from: T; to: T } | undefined,
): boolean {
  if (!diff) return false;
  return !deepEqual(diff.from, diff.to);
}
