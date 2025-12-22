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
import { DataGridBase } from "@/components/DataGrid/base/DataGridBase";
import { useColumnSizing } from "@/components/DataGrid/hooks/useColumnSizing";
import { TextSingleLineCellRenderer } from "@/components/DataGrid/renderers/TextCell";
import { indexColumns } from "./columns";
import { transformIndexesToRows } from "./utils";
import IndexNameCellRenderer from "./IndexNameCellRenderer";
import type { IndexGridRow } from "./types";
import { useCrudStore, buildCrudTableKey } from "@/stores/crudStore";
import { createIndexDropCommand } from "./commandFactory";
import { TableActionsToolbar } from "@/components/shared/TableActionsToolbar";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";
import { GlobalChangesDialog } from "@/components/GlobalChangesDialog";
import { toast } from "sonner";
import type { CrudCommandTarget, IndexDropPayload } from "@/types/crud";

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

  // Dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IndexGridRow | null>(null);
  const [globalChangesDialogOpen, setGlobalChangesDialogOpen] = useState(false);

  // crudStore integration
  const { stagedCommands, stageCommand, unstageCommand } = useCrudStore();

  const tableKey = useMemo(
    () => buildCrudTableKey({ connectionId, database, schema, table }),
    [connectionId, database, schema, table],
  );

  const pendingCommands = useMemo(() => {
    return stagedCommands.get(tableKey) ?? [];
  }, [stagedCommands, tableKey]);

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

  // Transform indexes to grid rows with stats and pending commands
  const gridRows = useMemo(
    () => transformIndexesToRows(indexes, pendingCommands, statsMap),
    [indexes, pendingCommands, statsMap],
  );

  // Handler: Delete index
  const handleDeleteIndex = useCallback(
    (row: IndexGridRow) => {
      // Cannot delete primary key indexes
      if (row.name_meta.primary) {
        toast.error("Cannot drop primary key index", {
          description: "Primary key indexes cannot be dropped directly",
        });
        return;
      }

      const target: CrudCommandTarget = {
        connectionId,
        database,
        schema,
        table,
      };
      const command = createIndexDropCommand(target, row.name);
      stageCommand(command);
      toast.success("Index deletion staged", {
        description: `${row.name} will be dropped when committed`,
      });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    },
    [connectionId, database, schema, table, stageCommand],
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
      const isPending = row._isPending ?? false;
      const isPendingDelete = row._isPendingDelete ?? false;

      // Row background - visual indicators for pending states
      const rowTheme = isPendingDelete
        ? {
            bgCell: "rgba(239, 68, 68, 0.08)", // red for pending delete
            bgCellMedium: "rgba(239, 68, 68, 0.12)",
            textDark: "#dc2626",
          }
        : isPending
        ? {
            bgCell: "rgba(34, 197, 94, 0.06)", // green for new indexes
            bgCellMedium: "rgba(34, 197, 94, 0.08)",
          }
        : undefined;

      // Actions column - Delete/Undo button
      if (column.field === "actions") {
        // Don't show delete for primary key indexes
        if (row.name_meta.primary) {
          return {
            kind: GridCellKind.Text,
            data: "",
            displayData: "",
            readonly: true,
            allowOverlay: false,
            themeOverride: rowTheme,
          } as const;
        }

        return {
          kind: GridCellKind.Text,
          data: isPendingDelete ? "↩️" : "🗑️",
          displayData: isPendingDelete ? "↩️" : "🗑️",
          readonly: true,
          allowOverlay: false,
          contentAlign: "center" as const,
          themeOverride: rowTheme,
        } as const;
      }

      // Make all cells readonly when row is pending delete
      if (isPendingDelete) {
        let displayValue = "";
        if (fieldValue == null) {
          displayValue = "";
        } else if (typeof fieldValue === "object") {
          displayValue = JSON.stringify(fieldValue);
        } else if (typeof fieldValue === "string" || typeof fieldValue === "number" || typeof fieldValue === "boolean") {
          displayValue = String(fieldValue);
        }
        return {
          kind: GridCellKind.Text,
          data: displayValue,
          displayData: displayValue,
          readonly: true,
          allowOverlay: false,
          themeOverride: rowTheme,
        } as const;
      }

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
          themeOverride: rowTheme,
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
        const columnsValue = typeof fieldValue === "string" ? fieldValue : "";
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
        const conditionValue = typeof fieldValue === "string" ? fieldValue : "";
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
        const statsValue = typeof fieldValue === "string" ? fieldValue : "—";
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
      const displayValue = typeof fieldValue === "string" ? fieldValue : "";
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

  // Handle cell click for actions
  const handleCellClick = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) return;

      // Handle action button click
      if (column.field === "actions") {
        // Skip for primary key indexes
        if (row.name_meta.primary) return;

        if (row._isPendingDelete) {
          // Undo pending delete
          const dropCommand = pendingCommands.find(
            (cmd) =>
              cmd.type === "index.drop" &&
              (cmd.payload as IndexDropPayload).indexName === row._original?.name,
          );
          if (dropCommand) {
            unstageCommand(dropCommand.id);
            toast.success("Delete undone", {
              description: `${row._original?.name} will no longer be dropped`,
            });
          }
        } else {
          // Show delete confirmation
          setDeleteTarget(row);
          setDeleteDialogOpen(true);
        }
      }
    },
    [sizedColumns, gridRows, pendingCommands, unstageCommand],
  );

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

  // Count pending index commands
  const pendingIndexCommands = pendingCommands.filter(
    (cmd) => cmd.type.startsWith("index."),
  );

  if (!hasIndexes && pendingIndexCommands.length === 0) {
    return (
      <>
        <div className="h-full flex flex-col">
          <TableActionsToolbar
            addButtonLabel="Create Index"
            onAdd={() => {
              toast.info("Index creation coming soon", {
                description: "Use SQL to create indexes for now",
              });
            }}
            onReviewChanges={() => { setGlobalChangesDialogOpen(true); }}
            pendingChangesCount={pendingIndexCommands.length}
          />
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <p className="text-xs">No indexes defined for this table.</p>
          </div>
        </div>

        <GlobalChangesDialog
          open={globalChangesDialogOpen}
          onOpenChange={setGlobalChangesDialogOpen}
          connectionId={connectionId}
          database={database}
          schema={schema}
          table={table}
          onCommitSuccess={() => {
            loadIndexes().catch(() => undefined);
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className="h-full flex flex-col">
        <TableActionsToolbar
          addButtonLabel="Create Index"
          onAdd={() => {
            toast.info("Index creation coming soon", {
              description: "Use SQL to create indexes for now",
            });
          }}
          onReviewChanges={() => { setGlobalChangesDialogOpen(true); }}
          pendingChangesCount={pendingIndexCommands.length}
        />
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
            onCellClicked={handleCellClick}
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

      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Drop Index"
        description="Are you sure you want to drop this index? This may affect query performance. The action cannot be undone."
        entityName={deleteTarget?.name}
        onConfirm={() => {
          if (deleteTarget) {
            handleDeleteIndex(deleteTarget);
          }
        }}
      />

      <GlobalChangesDialog
        open={globalChangesDialogOpen}
        onOpenChange={setGlobalChangesDialogOpen}
        connectionId={connectionId}
        database={database}
        schema={schema}
        table={table}
        onCommitSuccess={() => {
          loadIndexes().catch(() => undefined);
        }}
      />
    </>
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
