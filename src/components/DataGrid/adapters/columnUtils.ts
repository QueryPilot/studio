import type { GridColumnV2 } from "../types";
import { shouldUseFullWidth } from "@/components/DataGrid/glide/types";

export const computeBaseWidth = (
  name: string,
  dbType: string | null | undefined,
): number => {
  const type = dbType?.toLowerCase() ?? "";
  const nameLower = name.toLowerCase();

  // Special handling for query plans and explain output - no practical limit
  if (nameLower === "query plan" || nameLower === "explain") {
    return 5000; // Very wide to show full query plans without truncation
  }

  if (shouldUseFullWidth(type)) {
    if (type.includes("timestamp")) return 180;
    if (type.includes("date")) return 120;
    if (type.includes("time")) return 120;
    return Math.max(100, name.length * 8 + 56);
  }

  // For text columns, use a reasonable default based on column name length
  // with a max of 250px to prevent overly wide columns
  if (type.includes("text") || type.includes("varchar") || type.includes("char")) {
    return Math.max(120, Math.min(250, name.length * 8 + 48));
  }

  // Default width based on column name length, capped at 200px
  return Math.max(96, Math.min(200, name.length * 8 + 48));
};

export const reorderColumns = (
  columns: GridColumnV2[],
  order: string[],
): GridColumnV2[] => {
  if (order.length === 0) return columns;
  const lookup = new Map(columns.map((column) => [column.id, column] as const));
  const ordered = order
    .map((id) => lookup.get(id))
    .filter((column): column is GridColumnV2 => Boolean(column));
  if (ordered.length === columns.length) {
    return ordered;
  }
  const missing = columns.filter((column) => !order.includes(column.id));
  return [...ordered, ...missing];
};

export const filterVisibleColumns = (
  columns: GridColumnV2[],
  visibility: Record<string, boolean>,
): GridColumnV2[] =>
  columns.filter((column) => visibility[column.id] !== false);

export const applyPinnedOrdering = (
  columns: GridColumnV2[],
  pinned: string[],
  maxPinned = 5,
): { columns: GridColumnV2[]; freezeColumns: number } => {
  if (pinned.length === 0) return { columns, freezeColumns: 0 };
  const pinnedSet = new Set(pinned);
  const pinnedColumns = columns.filter((column) => pinnedSet.has(column.id));
  const remainingColumns = columns.filter(
    (column) => !pinnedSet.has(column.id),
  );
  const freezeColumns = Math.min(pinnedColumns.length, maxPinned);
  return {
    columns: [...pinnedColumns, ...remainingColumns],
    freezeColumns,
  };
};
