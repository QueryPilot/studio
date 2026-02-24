/**
 * Document Cell Factory
 *
 * Converts MongoDB document values to GridCell instances for the DataGrid.
 * Handles nested objects/arrays with DrillableCell, primitives with existing renderers.
 */

import { GridCellKind, type GridCell } from '@glideapps/glide-data-grid';
import type { GridColumnV2 } from '../types';
import {
  createDrillableObjectCell,
  createDrillableArrayCell,
} from '../renderers/DrillableCell';

// ============================================================================
// Types
// ============================================================================

export interface DocumentCellValue {
  value: unknown;
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'objectId' | 'date' | 'binary';
}

export interface DocumentCellOptions {
  /** The raw value from the document */
  value: unknown;
  /** Column definition */
  column: GridColumnV2;
  /** Best-effort type hint for null values in sparse columns */
  nullTypeHint?: DocumentCellValue['type'];
  /** Whether the cell is read-only */
  readOnly?: boolean;
  /** Whether drill-down is enabled for nested values */
  canDrillDown?: boolean;
}

// ============================================================================
// Type Detection
// ============================================================================

/**
 * Detect the MongoDB-compatible type of a value
 */
export function detectDocumentValueType(value: unknown): DocumentCellValue['type'] {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (typeof value === 'object') {
    // Check for MongoDB special types
    const obj = value as Record<string, unknown>;

    // ObjectId: { $oid: "..." }
    if ('$oid' in obj && typeof obj.$oid === 'string') {
      return 'objectId';
    }

    // Date: { $date: "..." } or Date instance
    if ('$date' in obj || value instanceof Date) {
      return 'date';
    }

    // Binary: { $binary: { base64: "...", subType: "..." } }
    if ('$binary' in obj) {
      return 'binary';
    }

    return 'object';
  }

  if (typeof value === 'string') {
    return 'string';
  }

  if (typeof value === 'number') {
    return 'number';
  }

  if (typeof value === 'boolean') {
    return 'boolean';
  }

  return 'string'; // Fallback
}

// ============================================================================
// Cell Builders
// ============================================================================

/**
 * Build a GridCell for a document value
 */
export function buildDocumentCell(opts: DocumentCellOptions): GridCell {
  const { value, column, nullTypeHint, readOnly = false, canDrillDown = true } = opts;

  const valueType = detectDocumentValueType(value);

  switch (valueType) {
    case 'null':
      return buildNullCell(column, readOnly, nullTypeHint);

    case 'object':
      return buildObjectCell(value as Record<string, unknown>, column, readOnly, canDrillDown);

    case 'array':
      return buildArrayCell(value as unknown[], column, readOnly, canDrillDown);

    case 'objectId':
      return buildObjectIdCell(value as { $oid: string }, column, readOnly);

    case 'date':
      return buildDateCell(value, column, readOnly);

    case 'binary':
      return buildBinaryCell(value as { $binary: { base64: string; subType: string } }, column, readOnly);

    case 'number':
      return buildNumberCell(value as number, column, readOnly);

    case 'boolean':
      return buildBooleanCell(value as boolean, column, readOnly);

    case 'string':
    default:
      return buildStringCell(value as string, column, readOnly);
  }
}

function buildNullCell(
  column: GridColumnV2,
  readOnly: boolean,
  nullTypeHint?: DocumentCellValue['type']
): GridCell {
  const contentAlign =
    nullTypeHint === 'number'
      ? 'right'
      : nullTypeHint === 'boolean'
      ? 'center'
      : 'left';

  return {
    kind: GridCellKind.Custom,
    data: {
      kind: 'text-single-cell',
      value: null,
      nullable: true,
      columnName: column.title || column.id,
      isPrimaryKey: column.field === '_id',
      dbType: 'document_null',
    },
    copyData: 'null',
    allowOverlay: !readOnly,
    readonly: readOnly,
    contentAlign,
  };
}

function buildObjectCell(
  value: Record<string, unknown>,
  _column: GridColumnV2,
  _readOnly: boolean,
  canDrillDown: boolean
): GridCell {
  // Use DrillableCell for nested objects
  return createDrillableObjectCell(value, canDrillDown) as unknown as GridCell;
}

function buildArrayCell(
  value: unknown[],
  _column: GridColumnV2,
  _readOnly: boolean,
  canDrillDown: boolean
): GridCell {
  // Use DrillableCell for arrays
  return createDrillableArrayCell(value, canDrillDown) as unknown as GridCell;
}

function buildObjectIdCell(value: { $oid: string }, column: GridColumnV2, readOnly: boolean): GridCell {
  const oid = value.$oid;
  return {
    kind: GridCellKind.Custom,
    data: {
      kind: 'text-single-cell',
      value: oid,
      nullable: false,
      columnName: column.title || column.id,
      isPrimaryKey: column.field === '_id',
      dbType: 'objectId',
    },
    copyData: oid,
    allowOverlay: !readOnly,
    readonly: readOnly,
    themeOverride: {
      textDark: '#8b5cf6', // Purple for ObjectIds
      baseFontStyle: '400 11px monospace',
    },
  };
}

function buildDateCell(value: unknown, column: GridColumnV2, readOnly: boolean): GridCell {
  let dateStr: string;

  if (value instanceof Date) {
    dateStr = value.toISOString();
  } else if (typeof value === 'object' && value !== null && '$date' in value) {
    const dateVal = (value as { $date: string | number }).$date;
    dateStr = typeof dateVal === 'number'
      ? new Date(dateVal).toISOString()
      : dateVal;
  } else {
    dateStr = String(value);
  }

  return {
    kind: GridCellKind.Custom,
    data: {
      kind: 'datetime-cell',
      value: dateStr,
      nullable: true,
      columnName: column.title || column.id,
      isPrimaryKey: false,
      dbType: 'date',
    },
    copyData: dateStr,
    allowOverlay: !readOnly,
    readonly: readOnly,
  };
}

function buildBinaryCell(
  value: { $binary: { base64: string; subType: string } },
  _column: GridColumnV2,
  _readOnly: boolean
): GridCell {
  const preview = `[Binary: ${value.$binary.subType}]`;
  return {
    kind: GridCellKind.Text,
    data: preview,
    displayData: preview,
    allowOverlay: false,
    readonly: true,
    themeOverride: {
      textDark: 'rgba(127,127,127,0.7)',
      baseFontStyle: 'italic 12px',
    },
  };
}

function buildNumberCell(value: number, column: GridColumnV2, readOnly: boolean): GridCell {
  const strValue = String(value);
  return {
    kind: GridCellKind.Custom,
    data: {
      kind: 'number-cell',
      value: strValue,
      nullable: true,
      dbType: Number.isInteger(value) ? 'integer' : 'double',
      columnName: column.title || column.id,
      isPrimaryKey: false,
    },
    copyData: strValue,
    allowOverlay: !readOnly,
    readonly: readOnly,
    contentAlign: 'right',
  };
}

function buildBooleanCell(value: boolean, column: GridColumnV2, readOnly: boolean): GridCell {
  return {
    kind: GridCellKind.Custom,
    data: {
      kind: 'boolean-cell',
      value,
      columnName: column.title || column.id,
      isPrimaryKey: false,
      dbType: 'boolean',
    },
    copyData: String(value),
    allowOverlay: !readOnly,
    readonly: readOnly,
    contentAlign: 'center',
  };
}

function buildStringCell(value: string, column: GridColumnV2, readOnly: boolean): GridCell {
  // Use single-line for short strings, multi-line for long ones
  const isMultiLine = value.length > 200 || value.includes('\n');

  return {
    kind: GridCellKind.Custom,
    data: {
      kind: isMultiLine ? 'text-multi-cell' : 'text-single-cell',
      value,
      nullable: true,
      columnName: column.title || column.id,
      isPrimaryKey: false,
      dbType: 'string',
    },
    copyData: value,
    allowOverlay: !readOnly,
    readonly: readOnly,
  };
}

// ============================================================================
// Column Generation
// ============================================================================

/**
 * Generate columns from a set of documents by unioning all keys
 */
export function generateColumnsFromDocuments(
  documents: Record<string, unknown>[],
  options?: {
    /** Fields to always show first (e.g., ['_id']) */
    priorityFields?: string[];
    /** Fields to exclude */
    excludeFields?: string[];
  }
): GridColumnV2[] {
  const { priorityFields = ['_id'], excludeFields = [] } = options || {};

  // Collect all unique keys from documents
  const keySet = new Set<string>();
  for (const doc of documents) {
    for (const key of Object.keys(doc)) {
      if (!excludeFields.includes(key)) {
        keySet.add(key);
      }
    }
  }

  // Sort keys: priority fields first, then alphabetical
  const keys = Array.from(keySet).sort((a, b) => {
    const aIndex = priorityFields.indexOf(a);
    const bIndex = priorityFields.indexOf(b);

    if (aIndex !== -1 && bIndex !== -1) {
      return aIndex - bIndex;
    }
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;

    return a.localeCompare(b);
  });

  // Create column definitions
  // Note: We don't include `meta` since document fields don't have full database metadata
  return keys.map((key, index) => ({
    id: key,
    field: key,
    title: key,
    name: key,
    width: key === '_id' ? 220 : 150,
    meta: {
      name: key,
      db_type: 'document_field',
      nullable: true,
      default: null,
      is_pk: key === '_id',
      is_fk: false,
      ordinal: index,
    },
  }));
}

/**
 * Generate columns for array items (when drilled into an array)
 */
export function generateColumnsForArrayItems(): GridColumnV2[] {
  return [
    {
      id: '__index',
      field: '__index',
      title: 'Index',
      name: 'Index',
      width: 80,
      meta: {
        name: '__index',
        db_type: 'integer',
        nullable: false,
        default: null,
        is_pk: true,
        is_fk: false,
        ordinal: 0,
      },
    },
    {
      id: '__value',
      field: '__value',
      title: 'Value',
      name: 'Value',
      width: 400,
      meta: {
        name: '__value',
        db_type: 'any',
        nullable: true,
        default: null,
        is_pk: false,
        is_fk: false,
        ordinal: 1,
      },
    },
  ];
}
