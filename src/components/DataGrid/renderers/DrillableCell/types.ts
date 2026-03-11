import type { CustomCell } from "@glideapps/glide-data-grid";
import { GridCellKind } from "@glideapps/glide-data-grid";

export const DRILLABLE_CELL_KIND = "drillable-cell" as const;

export interface DrillableCellData {
  /** Custom cell type identifier */
  kind: typeof DRILLABLE_CELL_KIND;
  /** Whether this is an object or array */
  type: "object" | "array";
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

function formatInlineValuePreview(value: unknown, maxLen = 20): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    if (value.length <= maxLen) return `"${value}"`;
    return `"${value.slice(0, maxLen - 3)}…"`;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[${value.length}]`;
  }
  if (typeof value === "object") {
    return formatObjectPreview(value as Record<string, unknown>);
  }
  return "[value]";
}

function formatObjectPreview(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "{}";
  // Show up to 2 key:value pairs with compact values
  const parts: string[] = [];
  const maxParts = 2;
  for (let i = 0; i < Math.min(keys.length, maxParts); i++) {
    const k = keys[i]!;
    const v = formatInlineValuePreview(obj[k], 12);
    parts.push(`${k}: ${v}`);
  }
  const remaining = keys.length - parts.length;
  if (remaining > 0) parts.push(`+${remaining}`);
  return `{${parts.join(", ")}}`;
}

/**
 * Creates a drillable cell for nested objects
 */
export function createDrillableObjectCell(
  value: Record<string, unknown>,
  canDrillDown = true,
): DrillableCell {
  const keys = Object.keys(value);
  const itemCount = keys.length;
  const preview = formatObjectPreview(value);

  return {
    kind: GridCellKind.Custom,
    readonly: true,
    allowOverlay: false,
    copyData: JSON.stringify(value),
    data: {
      kind: DRILLABLE_CELL_KIND,
      type: "object",
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
  canDrillDown = true,
): DrillableCell {
  const itemCount = value.length;
  let preview: string;
  if (itemCount === 0) {
    preview = "[]";
  } else {
    // Show compact preview of first item
    const first = value[0];
    const firstPreview = formatInlineValuePreview(first, 30);
    preview = `[${itemCount}] ${firstPreview}`;
  }

  return {
    kind: GridCellKind.Custom,
    readonly: true,
    allowOverlay: false,
    copyData: JSON.stringify(value),
    data: {
      kind: DRILLABLE_CELL_KIND,
      type: "array",
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
    data && typeof data === "object" && data.kind === DRILLABLE_CELL_KIND,
  );
}
