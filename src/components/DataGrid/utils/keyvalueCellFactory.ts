/**
 * Key-Value Cell Factory
 *
 * Converts Redis values to GridCell instances for the DataGrid.
 * Handles type-aware column/row mapping for all Redis data types.
 */

import { GridCellKind, type GridCell } from '@glideapps/glide-data-grid';
import type { GridColumnV2, GridRowModel } from '../types';
import type { RedisType } from '@/adapters/types/redis';
import type { CellValue } from '@/types';

// ============================================================================
// Types
// ============================================================================

export interface KeyValueCellOptions {
  /** The raw value */
  value: unknown;
  /** Column definition */
  column: GridColumnV2;
  /** Whether the cell is read-only */
  readOnly?: boolean;
  /** Redis key type */
  keyType?: RedisType;
}

// ============================================================================
// Column Definitions per Redis Type
// ============================================================================

/**
 * Get column definitions for a Redis key type
 */
/**
 * Helper to create a complete ColumnMeta object for Redis columns
 */
function createRedisMeta(
  name: string,
  dbType: string,
  nullable: boolean,
  isPk: boolean,
  ordinal: number
) {
  return {
    name,
    db_type: dbType,
    nullable,
    default: null,
    is_pk: isPk,
    is_fk: false,
    ordinal,
  };
}

export function getColumnsForRedisType(type: RedisType): GridColumnV2[] {
  switch (type) {
    case 'string':
      return [
        {
          id: 'value',
          field: 'value',
          title: 'Value',
          name: 'Value',
          width: 500,
          meta: createRedisMeta('value', 'text', false, false, 0),
        },
      ];

    case 'hash':
      return [
        {
          id: 'field',
          field: 'field',
          title: 'Field',
          name: 'Field',
          width: 200,
          meta: createRedisMeta('field', 'text', false, true, 0),
        },
        {
          id: 'value',
          field: 'value',
          title: 'Value',
          name: 'Value',
          width: 400,
          meta: createRedisMeta('value', 'text', false, false, 1),
        },
      ];

    case 'list':
      return [
        {
          id: 'index',
          field: 'index',
          title: 'Index',
          name: 'Index',
          width: 80,
          meta: createRedisMeta('index', 'integer', false, true, 0),
        },
        {
          id: 'value',
          field: 'value',
          title: 'Value',
          name: 'Value',
          width: 400,
          meta: createRedisMeta('value', 'text', false, false, 1),
        },
      ];

    case 'set':
      return [
        {
          id: 'member',
          field: 'member',
          title: 'Member',
          name: 'Member',
          width: 400,
          meta: createRedisMeta('member', 'text', false, true, 0),
        },
      ];

    case 'zset':
      return [
        {
          id: 'score',
          field: 'score',
          title: 'Score',
          name: 'Score',
          width: 120,
          meta: createRedisMeta('score', 'double', false, false, 0),
        },
        {
          id: 'member',
          field: 'member',
          title: 'Member',
          name: 'Member',
          width: 400,
          meta: createRedisMeta('member', 'text', false, true, 1),
        },
      ];

    case 'stream':
      return [
        {
          id: 'id',
          field: 'id',
          title: 'ID',
          name: 'ID',
          width: 180,
          meta: createRedisMeta('id', 'text', false, true, 0),
        },
        {
          id: 'fields',
          field: 'fields',
          title: 'Fields',
          name: 'Fields',
          width: 400,
          meta: createRedisMeta('fields', 'json', false, false, 1),
        },
      ];

    case 'unknown':
    default:
      return [
        {
          id: 'value',
          field: 'value',
          title: 'Value',
          name: 'Value',
          width: 500,
          meta: createRedisMeta('value', 'text', true, false, 0),
        },
      ];
  }
}

// ============================================================================
// Row Mapping per Redis Type
// ============================================================================

/**
 * Convert Redis data to GridRowModel array based on type
 */
export function mapRedisDataToRows(
  data: unknown,
  type: RedisType
): GridRowModel[] {
  switch (type) {
    case 'string':
      return mapStringToRows(data as string);

    case 'hash':
      return mapHashToRows(data as Record<string, string>);

    case 'list':
      return mapListToRows(data as string[]);

    case 'set':
      return mapSetToRows(data as string[]);

    case 'zset':
      return mapZSetToRows(data as Array<{ member: string; score: number }>);

    case 'stream':
      return mapStreamToRows(data as Array<{ id: string; fields: Record<string, string> }>);

    case 'unknown':
    default:
      return mapUnknownToRows(data);
  }
}

function createCellValue(value: unknown, dbType: string): CellValue {
  return {
    value,
    db_type: dbType,
    value_type: typeof value === 'number' ? 'Integer' : 'Text',
    is_truncated: false,
  };
}

function mapStringToRows(data: string): GridRowModel[] {
  // Single row for string type
  return [
    {
      value: createCellValue(data, 'text'),
    },
  ];
}

function mapHashToRows(data: Record<string, string>): GridRowModel[] {
  return Object.entries(data).map(([field, value]) => ({
    field: createCellValue(field, 'text'),
    value: createCellValue(value, 'text'),
  }));
}

function mapListToRows(data: string[]): GridRowModel[] {
  return data.map((value, index) => ({
    index: createCellValue(index, 'integer'),
    value: createCellValue(value, 'text'),
  }));
}

function mapSetToRows(data: string[]): GridRowModel[] {
  return data.map((member) => ({
    member: createCellValue(member, 'text'),
  }));
}

function mapZSetToRows(data: Array<{ member: string; score: number }>): GridRowModel[] {
  return data.map(({ member, score }) => ({
    score: createCellValue(score, 'double'),
    member: createCellValue(member, 'text'),
  }));
}

function mapStreamToRows(
  data: Array<{ id: string; fields: Record<string, string> }>
): GridRowModel[] {
  return data.map(({ id, fields }) => ({
    id: createCellValue(id, 'text'),
    fields: createCellValue(JSON.stringify(fields), 'json'),
  }));
}

function mapUnknownToRows(data: unknown): GridRowModel[] {
  const strValue = data === null || data === undefined ? '' : String(data);
  return [
    {
      value: createCellValue(strValue, 'text'),
    },
  ];
}

// ============================================================================
// Cell Builder
// ============================================================================

/**
 * Build a GridCell for a Redis value
 */
export function buildKeyValueCell(opts: KeyValueCellOptions): GridCell {
  const { value, column, readOnly = false, keyType } = opts;

  const cellValue = value as CellValue | null | undefined;
  const rawValue = cellValue?.value;
  const isPrimaryKey = column.meta?.is_pk ?? false;
  const isTypeReadOnly = keyType === 'list' || keyType === 'set' || keyType === 'stream';
  const isZsetReadOnly = keyType === 'zset' && column.field !== 'score';
  const isReadOnly = readOnly || isPrimaryKey || isTypeReadOnly || isZsetReadOnly;

  // Handle null/undefined
  if (rawValue === null || rawValue === undefined) {
    return {
      kind: GridCellKind.Text,
      data: '',
      displayData: '',
      allowOverlay: !isReadOnly,
      readonly: isReadOnly,
    };
  }

  // Score column for zset
  if (column.field === 'score') {
    const numStr = String(rawValue);
    return {
      kind: GridCellKind.Custom,
      data: {
        kind: 'number-cell',
        value: numStr,
        nullable: false,
        dbType: 'double',
        columnName: column.title || column.id,
        isPrimaryKey: false,
      },
      copyData: numStr,
      allowOverlay: !isReadOnly,
      readonly: isReadOnly,
      contentAlign: 'right',
    };
  }

  // Index column for list
  if (column.field === 'index') {
    const numStr = String(rawValue);
    return {
      kind: GridCellKind.Custom,
      data: {
        kind: 'number-cell',
        value: numStr,
        nullable: false,
        dbType: 'integer',
        columnName: column.title || column.id,
        isPrimaryKey: true,
      },
      copyData: numStr,
      allowOverlay: false, // Index is read-only
      readonly: true,
      contentAlign: 'right',
    };
  }

  // Fields column for stream (JSON)
  if (column.field === 'fields') {
    const jsonStr = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
    return {
      kind: GridCellKind.Custom,
      data: {
        kind: 'json-cell',
        value: jsonStr,
        nullable: false,
        isValid: true,
        columnName: column.title || column.id,
        isPrimaryKey: false,
        dbType: 'json',
      },
      copyData: jsonStr,
      allowOverlay: !isReadOnly,
      readonly: isReadOnly,
    };
  }

  // ID column for stream
  if (column.field === 'id') {
    const strValue = String(rawValue);
    return {
      kind: GridCellKind.Custom,
      data: {
        kind: 'text-single-cell',
        value: strValue,
        nullable: false,
        columnName: column.title || column.id,
        isPrimaryKey: true,
        dbType: 'text',
      },
      copyData: strValue,
      allowOverlay: false, // Stream ID is read-only
      readonly: true,
      themeOverride: {
        baseFontStyle: '400 11px monospace',
      },
    };
  }

  // Default: text cell for field, value, member columns
  const strValue = String(rawValue);
  const isMultiLine = strValue.length > 200 || strValue.includes('\n');

  return {
    kind: GridCellKind.Custom,
    data: {
      kind: isMultiLine ? 'text-multi-cell' : 'text-single-cell',
      value: strValue,
      nullable: false,
      columnName: column.title || column.id,
      isPrimaryKey: column.meta?.is_pk ?? false,
      dbType: 'text',
    },
    copyData: strValue,
    allowOverlay: !isReadOnly,
    readonly: isReadOnly,
  };
}

// ============================================================================
// CRUD Command Helpers
// ============================================================================

/**
 * Get the primary key value for a Redis row (used for CRUD operations)
 */
export function getRedisRowKey(
  row: GridRowModel,
  type: RedisType
): Record<string, unknown> {
  switch (type) {
    case 'hash':
      return { field: (row.field as CellValue)?.value };

    case 'list':
      return { index: (row.index as CellValue)?.value };

    case 'set':
      return { member: (row.member as CellValue)?.value };

    case 'zset':
      return { member: (row.member as CellValue)?.value };

    case 'stream':
      return { id: (row.id as CellValue)?.value };

    case 'string':
    default:
      return {};
  }
}
