import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  GridCellKind,
  type Item,
  type CustomCell,
  type CustomRenderer,
} from "@glideapps/glide-data-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { IconAlertCircle } from "@tabler/icons-react";
import { databaseService, type TableIndex } from "@/services/databaseService";
import type { IndexUsageStats } from "@/services/backend";
import { EditableDataGrid } from "@/components/DataGrid/base/EditableDataGrid";
import type {
  GridEditCommitEvent,
  GridRowModel,
} from "@/components/DataGrid/types";
import { useColumnSizing } from "@/components/DataGrid/hooks/useColumnSizing";
import { TextSingleLineCellRenderer } from "@/components/DataGrid/renderers/TextCell";
import { indexColumns } from "./columns";
import { transformIndexesToRows } from "./utils";
import IndexNameCellRenderer from "./IndexNameCellRenderer";
import type { IndexGridRow } from "./types";

type AnyCell = CustomCell<Record<string, unknown>>;

interface TableIndexesProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const TableIndexes = memo(function TableIndexes({
  connectionId,
  database,
  table,
  schema,
  onActionsChange: _onActionsChange,
}: TableIndexesProps) {
  const [indexes, setIndexes] = useState<TableIndex[]>([]);
  const [statsMap, setStatsMap] = useState<Map<string, IndexUsageStats>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadIndexes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [indexResult, statsResult] = await Promise.all([
        databaseService.tableIndexes(
          connectionId,
          database,
          schema || "public",
          table,
        ),
        databaseService
          .getIndexUsageStats(connectionId, schema || "public", table)
          .catch(() => [] as IndexUsageStats[]), // Silently fail for stats
      ]);

      setIndexes(indexResult);

      // Build stats map by index name
      const newStatsMap = new Map<string, IndexUsageStats>();
      for (const stat of statsResult) {
        newStatsMap.set(stat.index_name, stat);
      }
      setStatsMap(newStatsMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load indexes");
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, database, schema, table]);

  useEffect(() => {
    void loadIndexes();
  }, [loadIndexes]);

  // Transform indexes to grid rows with stats
  const gridRows = useMemo(
    () => transformIndexesToRows(indexes, [], statsMap),
    [indexes, statsMap],
  );

  // Enable column resizing
  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: indexColumns,
      initialWidths: {},
      onChange: () => {}, // No persistence needed for now
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

      const fieldValue = row[column.field as keyof IndexGridRow];

      // Custom cell for index name with badges
      if (column.field === "name") {
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "index-name-cell",
            name: row.name,
            isPrimary: row.name_meta.primary,
            isUnique: row.name_meta.unique,
          },
          copyData: row.name,
          readonly: true,
          allowOverlay: false,
        } as const;
      }

      // Row number (right-aligned, muted)
      if (column.field === "row_number") {
        return {
          kind: GridCellKind.Text,
          data: String(fieldValue),
          displayData: String(fieldValue),
          readonly: true,
          allowOverlay: false,
          contentAlign: "right" as const,
          themeOverride: {
            textDark: "rgba(127, 127, 127, 0.7)",
          },
        } as const;
      }

      // Unique column with colored background
      if (column.field === "unique") {
        const uniqueValue = String(fieldValue);
        const isUnique = uniqueValue === "YES";
        return {
          kind: GridCellKind.Text,
          data: uniqueValue,
          displayData: uniqueValue,
          readonly: true,
          allowOverlay: false,
          contentAlign: "center" as const,
          themeOverride: isUnique
            ? {
                bgCell: "rgba(16, 185, 129, 0.15)", // emerald-500 with 15% opacity
                textDark: "#059669", // emerald-600
              }
            : undefined,
        } as const;
      }

      // Columns (monospace font) - editable for viewing
      if (column.field === "columns") {
        const columnsValue = String(fieldValue ?? "");
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "text-single-cell",
            value: columnsValue || null,
          },
          copyData: columnsValue,
          readonly: true, // Read-only but allows overlay to view full content
          allowOverlay: true,
          themeOverride: {
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      // Condition/Definition (monospace font with blue color) - editable for viewing
      if (column.field === "condition") {
        const conditionValue = String(fieldValue ?? "");
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "text-single-cell",
            value: conditionValue || null,
          },
          copyData: conditionValue,
          readonly: true, // Read-only but allows overlay to view full content
          allowOverlay: true,
          themeOverride: {
            baseFontStyle: "400 11px monospace",
            textDark: "#3b82f6", // blue-500
          },
        } as const;
      }

      // Statistics cell with color coding
      if (column.field === "statistics") {
        const statsValue = String(fieldValue ?? "—");
        const isUnused = row.stats?.is_unused ?? false;
        return {
          kind: GridCellKind.Text,
          data: statsValue,
          displayData: statsValue,
          readonly: true,
          allowOverlay: false,
          themeOverride: isUnused
            ? {
                bgCell: "rgba(239, 68, 68, 0.1)", // red-500 with 10% opacity
                textDark: "#dc2626", // red-600
              }
            : undefined, // Use default text color
        } as const;
      }

      // Default text cell (index_type)
      const displayValue = String(fieldValue ?? "");
      return {
        kind: GridCellKind.Text,
        data: displayValue,
        displayData: displayValue,
        readonly: true,
        allowOverlay: false,
      } as const;
    },
    [gridRows, sizedColumns],
  );

  const hasIndexes = useMemo(() => indexes.length > 0, [indexes.length]);

  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      IndexNameCellRenderer as unknown as CustomRenderer<AnyCell>,
      TextSingleLineCellRenderer as unknown as CustomRenderer<AnyCell>,
    ],
    [],
  );

  // Handle cell edit commit (for read-only overlays, just cancel)
  const handleCellEditCommit = useCallback((_event: GridEditCommitEvent) => {
    // Read-only - don't actually save edits
    return undefined;
  }, []);

  if (isLoading) {
    return <TableIndexesSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 select-text">
        <IconAlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load indexes</h3>
        <p className="text-xs text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  if (!hasIndexes) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-xs">No indexes defined for this table.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1">
        <EditableDataGrid
          rows={gridRows as unknown as GridRowModel[]}
          columns={sizedColumns}
          getCellContent={getCellContent}
          customRenderers={customRenderers}
          onCellEditCommit={handleCellEditCommit}
          onColumnResize={handleColumnResize}
          onColumnResizeEnd={handleColumnResizeEnd}
        />
      </div>
      <div className="px-4 py-2 text-xs text-muted-foreground border-t">
        Total indexes: {indexes.length}
        <button
          type="button"
          onClick={() => loadIndexes().catch(() => undefined)}
          className="ml-4 text-primary hover:underline"
        >
          Refresh
        </button>
      </div>
    </div>
  );
});

const TableIndexesSkeleton = memo(function TableIndexesSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-4 mb-4">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-28" />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-8 w-12" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-28" />
        </div>
      ))}
    </div>
  );
});

export default TableIndexes;
