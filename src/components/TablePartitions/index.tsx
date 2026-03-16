/**
 * TablePartitions - Displays MySQL/MariaDB table partition information
 *
 * Read-only view of partition metadata including:
 * - Partition name, type, expression
 * - Partition values/ranges
 * - Row count and data size
 */

import { memo, useMemo, useCallback } from "react";
import { GridCellKind, type Item } from "@glideapps/glide-data-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { IconAlertCircle, IconLayoutGrid } from "@tabler/icons-react";
import { DataGridBase } from "@/components/DataGrid/base/DataGridBase";
import { useColumnSizing, EMPTY_INITIAL_WIDTHS, NOOP_ON_CHANGE } from "@/components/DataGrid/hooks/useColumnSizing";
import { usePartitionsQuery } from "@/hooks/usePartitionsQuery";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import { DbType } from "@/types/connection";
import type { Partition } from "@/services/backend";
import type { GridColumnV2 } from "@/components/DataGrid/types";

// Format bytes to human-readable size
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

// Format large numbers with commas
function formatNumber(num: number | null | undefined): string {
  if (num == null) return "—";
  return num.toLocaleString();
}

const partitionColumns: GridColumnV2[] = [
  { id: "row_number", field: "row_number", title: "#", name: "#", width: 40 },
  { id: "partition_name", field: "partition_name", title: "Name", name: "Name", width: 150 },
  { id: "type", field: "type", title: "Type", name: "Type", width: 100 },
  { id: "expression", field: "expression", title: "Expression", name: "Expression", width: 180 },
  { id: "description", field: "description", title: "Values/Range", name: "Values/Range", width: 200 },
  { id: "rows", field: "rows", title: "Rows", name: "Rows", width: 100 },
  { id: "data_length", field: "data_length", title: "Data Size", name: "Data Size", width: 100 },
  { id: "index_length", field: "index_length", title: "Index Size", name: "Index Size", width: 100 },
];

interface PartitionGridRow {
  row_number: number;
  partition_name: string;
  type: string;
  expression: string;
  description: string;
  rows: string;
  data_length: string;
  index_length: string;
  _original: Partition;
}

function transformPartitionsToRows(partitions: Partition[]): PartitionGridRow[] {
  return partitions.map((p, index) => ({
    row_number: index + 1,
    partition_name: p.partition_name,
    type: p.partition_method || "—",
    expression: p.partition_expression || "—",
    description: p.partition_description || "—",
    rows: formatNumber(p.table_rows),
    data_length: formatBytes(p.data_length),
    index_length: formatBytes(p.index_length),
    _original: p,
  }));
}

interface TablePartitionsProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const TablePartitions = memo(function TablePartitions({
  connectionId,
  database,
  table,
  schema,
  onActionsChange: _onActionsChange,
}: TablePartitionsProps) {
  // Get connection info for dbType
  const connection = useConnectionStore((s) => s.getConnection(connectionId));
  const dbType = connection?.profile.db_type ?? DbType.MySQL;

  const { partitions, isLoading, error, refetch, hasPartitions } = usePartitionsQuery({
    connectionId,
    schema: schema || database,
    table,
    dbType,
    enabled: true,
  });

  const gridRows = useMemo(
    () => transformPartitionsToRows(partitions),
    [partitions]
  );

  // Enable column resizing
  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: partitionColumns,
      initialWidths: EMPTY_INITIAL_WIDTHS,
      onChange: NOOP_ON_CHANGE,
    });

  // Cell content factory
  const getCellContent = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) {
        return {
          kind: GridCellKind.Text,
          data: "",
          displayData: "",
          readonly: true,
          allowOverlay: false,
        } as const;
      }

      const fieldValue = row[column.field as keyof PartitionGridRow];
      const displayValue = typeof fieldValue === "string" || typeof fieldValue === "number"
        ? String(fieldValue)
        : "";

      // Row number column - right aligned, muted
      if (column.field === "row_number") {
        return {
          kind: GridCellKind.Text,
          data: displayValue,
          displayData: displayValue,
          readonly: true,
          allowOverlay: false,
          contentAlign: "right" as const,
          themeOverride: {
            textDark: "rgba(127, 127, 127, 0.7)",
          },
        } as const;
      }

      // Numeric columns - right aligned
      if (["rows", "data_length", "index_length"].includes(column.field)) {
        return {
          kind: GridCellKind.Text,
          data: displayValue,
          displayData: displayValue,
          readonly: true,
          allowOverlay: false,
          contentAlign: "right" as const,
          themeOverride: {
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      // Expression column - monospace
      if (column.field === "expression") {
        return {
          kind: GridCellKind.Text,
          data: displayValue,
          displayData: displayValue,
          readonly: true,
          allowOverlay: true,
          themeOverride: {
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      // Type column - badge-like coloring
      if (column.field === "type") {
        const typeColors: Record<string, string> = {
          RANGE: "#3b82f6",      // blue
          LIST: "#8b5cf6",       // violet
          HASH: "#10b981",       // emerald
          KEY: "#f59e0b",        // amber
          LINEAR: "#ec4899",     // pink
        };
        const color = typeColors[displayValue.toUpperCase()] || "#6b7280";

        return {
          kind: GridCellKind.Text,
          data: displayValue,
          displayData: displayValue,
          readonly: true,
          allowOverlay: false,
          themeOverride: {
            textDark: color,
            baseFontStyle: "500 11px",
          },
        } as const;
      }

      // Default text cell
      return {
        kind: GridCellKind.Text,
        data: displayValue,
        displayData: displayValue,
        readonly: true,
        allowOverlay: true,
      } as const;
    },
    [gridRows, sizedColumns]
  );

  if (isLoading) {
    return <TablePartitionsSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 select-text">
        <IconAlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load partitions</h3>
        <p className="text-xs text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  if (!hasPartitions) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
        <IconLayoutGrid className="h-12 w-12 mb-4 opacity-30" />
        <p className="text-xs">This table is not partitioned.</p>
        <p className="text-xs mt-1 opacity-70">
          Use ALTER TABLE to add partitions if needed.
        </p>
      </div>
    );
  }

  // Calculate totals
  const totalRows = partitions.reduce((sum, p) => sum + (p.table_rows ?? 0), 0);
  const totalDataSize = partitions.reduce((sum, p) => sum + (p.data_length ?? 0), 0);

  return (
    <div className="h-full flex flex-col">
      {/* Header with summary */}
      <div className="flex items-center gap-4 px-1 pb-1.5 pt-0.5 bg-transparent text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">{partitions.length}</strong> partition{partitions.length !== 1 ? "s" : ""}
        </span>
        <span>
          <strong className="text-foreground">{formatNumber(totalRows)}</strong> total rows
        </span>
        <span>
          <strong className="text-foreground">{formatBytes(totalDataSize)}</strong> data
        </span>
      </div>

      {/* Data Grid */}
      <div className="flex-1">
        <DataGridBase
          columns={sizedColumns}
          rowCount={gridRows.length}
          getCellContent={getCellContent}
          rowSelect="none"
          columnSelect="none"
          onColumnResize={handleColumnResize}
          onColumnResizeEnd={handleColumnResizeEnd}
        />
      </div>

      {/* Footer */}
      <div className="px-4 py-2 text-xs text-muted-foreground border-t">
        Partition type: {partitions[0]?.partition_method || "Unknown"}
        <button
          type="button"
          onClick={() => refetch()}
          className="ml-4 text-primary hover:underline"
        >
          Refresh
        </button>
      </div>
    </div>
  );
});

const TablePartitionsSkeleton = memo(function TablePartitionsSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-4 mb-4">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
});

export default TablePartitions;
