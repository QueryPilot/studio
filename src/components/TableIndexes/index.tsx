import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  GridCellKind,
  type Item,
  type CustomCell,
  type CustomRenderer,
} from "@glideapps/glide-data-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { databaseService, type TableIndex } from "@/services/databaseService";
import { DataGridBase } from "@/components/DataGridV2/base/DataGridBase";
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadIndexes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await databaseService.tableIndexes(
        connectionId,
        database,
        schema || "public",
        table,
      );
      setIndexes(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load indexes");
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, database, schema, table]);

  useEffect(() => {
    void loadIndexes();
  }, [loadIndexes]);

  // Transform indexes to grid rows
  const gridRows = useMemo(
    () => transformIndexesToRows(indexes),
    [indexes],
  );

  // Cell content factory
  const getCellContent = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = indexColumns[colIndex];
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

      const value = row[column.field as keyof IndexGridRow];

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
          data: String(value),
          displayData: String(value),
          readonly: true,
          allowOverlay: false,
          contentAlign: "right" as const,
          themeOverride: {
            textDark: "rgba(127, 127, 127, 0.7)",
          },
        } as const;
      }

      // Columns and condition (monospace font)
      if (column.field === "columns" || column.field === "condition") {
        return {
          kind: GridCellKind.Text,
          data: String(value || ""),
          displayData: String(value || ""),
          readonly: true,
          allowOverlay: true,
          themeOverride: {
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      // Default text cell
      return {
        kind: GridCellKind.Text,
        data: String(value || ""),
        displayData: String(value || ""),
        readonly: true,
        allowOverlay: false,
      } as const;
    },
    [gridRows],
  );

  const hasIndexes = useMemo(() => indexes.length > 0, [indexes.length]);

  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [IndexNameCellRenderer as unknown as CustomRenderer<AnyCell>],
    [],
  );

  if (isLoading) {
    return <TableIndexesSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 select-text">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load indexes</h3>
        <p className="text-sm text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  if (!hasIndexes) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">No indexes defined for this table.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1">
        <DataGridBase
          columns={indexColumns}
          rowCount={gridRows.length}
          getCellContent={getCellContent}
          customRenderers={customRenderers}
          rowSelect="none"
          columnSelect="none"
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
