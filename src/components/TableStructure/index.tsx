import { memo, useMemo, useCallback } from "react";
import {
  GridCellKind,
  type Item,
  type CustomCell,
  type CustomRenderer,
} from "@glideapps/glide-data-grid";
import { useTableFullStructure } from "@/hooks/useTableFullStructure";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { DataGridBase } from "@/components/DataGridV2/base/DataGridBase";
import { useColumnSizing } from "@/components/DataGridV2/hooks/useColumnSizing";
import { structureColumns } from "./columns";
import { transformStructureToRows } from "./utils";
import ColumnNameCellRenderer from "./ColumnNameCellRenderer";
import type { StructureGridRow } from "./types";

type AnyCell = CustomCell<Record<string, unknown>>;

interface TableStructureProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  isView?: boolean;
  kind?: "Table" | "View" | "MaterializedView";
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const TableStructure = memo(function TableStructure({
  connectionId,
  database,
  table,
  schema,
  isView: _isView = false,
  kind: _kind,
  onActionsChange: _onActionsChange,
}: TableStructureProps) {
  const { structure, isLoading, error, refresh } = useTableFullStructure({
    connectionId,
    database,
    table,
    schema,
    options: {
      includeConstraints: true,
      includeForeignKeys: true,
    },
  });

  const columns = useMemo(() => structure?.columns ?? [], [structure?.columns]);
  const foreignKeys = useMemo(
    () => structure?.foreignKeys ?? [],
    [structure?.foreignKeys],
  );
  const constraints = useMemo(
    () => structure?.constraints ?? [],
    [structure?.constraints],
  );

  // Transform to grid rows
  const gridRows = useMemo(
    () => transformStructureToRows(columns, foreignKeys, constraints),
    [columns, foreignKeys, constraints],
  );

  // Enable column resizing
  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: structureColumns,
      initialWidths: {},
      onChange: () => {},
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

      const fieldValue = row[column.field as keyof StructureGridRow];

      // Custom cell for column name with PK/FK indicators
      if (column.field === "column_name") {
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "column-name-cell",
            name: row.column_name,
            isPrimaryKey: row.column_meta.is_pk,
            isForeignKey: row.column_meta.is_fk,
          },
          copyData: row.column_name,
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

      // Nullable column (center-aligned with color)
      if (column.field === "nullable") {
        const nullableValue = String(fieldValue);
        const isNullable = nullableValue === "YES";
        return {
          kind: GridCellKind.Text,
          data: nullableValue,
          displayData: nullableValue,
          readonly: true,
          allowOverlay: false,
          contentAlign: "center" as const,
          themeOverride: isNullable
            ? {
                textDark: "#f59e0b", // amber-500
              }
            : undefined,
        } as const;
      }

      // Type column (monospace)
      if (column.field === "db_type") {
        const typeValue = String(fieldValue ?? "");
        return {
          kind: GridCellKind.Text,
          data: typeValue,
          displayData: typeValue,
          readonly: true,
          allowOverlay: false,
          themeOverride: {
            baseFontStyle: "400 12px monospace",
          },
        } as const;
      }

      // Default, Foreign Key, Check, Comment (monospace, overlay allowed)
      if (
        column.field === "default" ||
        column.field === "foreign_key" ||
        column.field === "check_constraint" ||
        column.field === "comment"
      ) {
        const value = String(fieldValue ?? "");
        return {
          kind: GridCellKind.Text,
          data: value,
          displayData: value,
          readonly: true,
          allowOverlay: true,
          themeOverride: {
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      // Default text cell
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

  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [ColumnNameCellRenderer as unknown as CustomRenderer<AnyCell>],
    [],
  );

  if (isLoading) {
    return <TableStructureSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 select-text">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load structure</h3>
        <p className="text-sm text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm">No columns available for this object.</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1">
        <DataGridBase
          columns={sizedColumns}
          rowCount={gridRows.length}
          getCellContent={getCellContent}
          customRenderers={customRenderers}
          rowSelect="none"
          columnSelect="none"
          onColumnResize={handleColumnResize}
          onColumnResizeEnd={handleColumnResizeEnd}
        />
      </div>
      <div className="px-4 py-2 text-xs text-muted-foreground border-t">
        Last refreshed:{" "}
        {(structure as any)?.fetchedAt
          ? new Date(
              (structure as any).fetchedAt as string | number | Date,
            ).toLocaleString()
          : "n/a"}
        <button
          type="button"
          onClick={() => refresh().catch(() => undefined)}
          className="ml-4 text-primary hover:underline"
        >
          Refresh
        </button>
      </div>
    </div>
  );
});

const TableStructureSkeleton = memo(function TableStructureSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-4 mb-4">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-28" />
      </div>
      {Array.from({ length: 10 }).map((_, i) => (
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

export default TableStructure;

