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

function formatInlineValuePreview(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "[]";
  if (typeof value === "object") return "{}";
  if (typeof value === "string") {
    if (value.length <= 12) return `"${value}"`;
    return `"${value.slice(0, 9)}…"`;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (typeof value === "symbol") {
    return value.description ? `:${value.description}` : ":symbol";
  }
  return "[value]";
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
  let preview = "{}";
  if (itemCount > 0) {
    const visibleKeys = keys.slice(0, 2);
    const remaining = itemCount - visibleKeys.length;
    preview = `{${visibleKeys.join(", ")}${remaining > 0 ? `, +${remaining}` : ""}}`;
  }

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
  const sample = value[0];
  const preview =
    itemCount === 0
      ? "[]"
      : `[${itemCount}] ${formatInlineValuePreview(sample)}`;

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
