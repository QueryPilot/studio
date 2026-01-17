import type { CustomCell } from '@glideapps/glide-data-grid';
import { GridCellKind } from '@glideapps/glide-data-grid';

export const DRILLABLE_CELL_KIND = 'drillable-cell' as const;

export interface DrillableCellData {
  /** Custom cell type identifier */
  kind: typeof DRILLABLE_CELL_KIND;
  /** Whether this is an object or array */
  type: 'object' | 'array';
  /** Preview text like "{3 fields}" or "[5 items]" */
  preview: string;
  /** Number of items/fields */
  itemCount: number;
  /** Whether drill-down is enabled */
  canDrillDown: boolean;
  /** The raw value for potential editing */
  rawValue: unknown;
}

export interface DrillableCell extends CustomCell {
  kind: GridCellKind.Custom;
  readonly: true;
  allowOverlay: false;
  data: DrillableCellData;
  copyData: string;
}

/**
 * Creates a drillable cell for nested objects
 */
export function createDrillableObjectCell(
  value: Record<string, unknown>,
  canDrillDown = true
): DrillableCell {
  const keys = Object.keys(value);
  const itemCount = keys.length;
  const preview = `{${itemCount} field${itemCount !== 1 ? 's' : ''}}`;

  return {
    kind: GridCellKind.Custom,
    readonly: true,
    allowOverlay: false,
    copyData: JSON.stringify(value),
    data: {
      kind: DRILLABLE_CELL_KIND,
      type: 'object',
      preview,
      itemCount,
      canDrillDown,
      rawValue: value,
    },
  };
}

/**
 * Creates a drillable cell for arrays
 */
export function createDrillableArrayCell(
  value: unknown[],
  canDrillDown = true
): DrillableCell {
  const itemCount = value.length;
  const preview = `[${itemCount} item${itemCount !== 1 ? 's' : ''}]`;

  return {
    kind: GridCellKind.Custom,
    readonly: true,
    allowOverlay: false,
    copyData: JSON.stringify(value),
    data: {
      kind: DRILLABLE_CELL_KIND,
      type: 'array',
      preview,
      itemCount,
      canDrillDown,
      rawValue: value,
    },
  };
}

/**
 * Type guard for drillable cells
 */
export function isDrillableCell(cell: CustomCell): cell is DrillableCell {
  const data = cell.data as Record<string, unknown> | null;
  return Boolean(
    data && typeof data === 'object' && data.kind === DRILLABLE_CELL_KIND
  );
}
