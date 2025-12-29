import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  GridCellKind,
  type Item,
  type CustomCell,
  type CustomRenderer,
  type EditableGridCell,
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
import { IndexColumnsCellRenderer } from "./IndexColumnsCellRenderer";
import { IndexTypeCellRenderer } from "./IndexTypeCellRenderer";
import { IndexUniqueCellRenderer } from "./IndexUniqueCellRenderer";
import { ConditionCellRenderer } from "./ConditionCellRenderer";
import type { IndexGridRow } from "./types";
import { useCrudStore, buildCrudTableKey } from "@/stores/crudStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import {
  createIndexDropCommand,
  createIndexCreateCommand,
  createIndexRenameCommand,
  generateCommandId,
} from "./commandFactory";
import { TableActionsToolbar } from "@/components/shared/TableActionsToolbar";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";
import { GlobalChangesDialog } from "@/components/GlobalChangesDialog";
import { toast } from "sonner";
import type {
  CrudCommandTarget,
  IndexDropPayload,
  IndexCreatePayload,
} from "@/types/crud";
import { useSupportedIndexTypes } from "@/hooks/useSupportedIndexTypes";
import { useTableColumns } from "@/hooks/useTableFullStructure";
import { DbType } from "@/types/connection";

type AnyCell = CustomCell<Record<string, unknown>>;

/**
 * Convert DbType to SQL dialect string for the condition cell editor
 */
function getDialectFromDbType(dbType: DbType): string {
  switch (dbType) {
    case DbType.PostgreSQL:
      return "postgresql";
    case DbType.MySQL:
      return "mysql";
    case DbType.SQLite:
      return "sqlite";
    case DbType.SQLServer:
      return "mssql";
    default:
      return "postgresql";
  }
}

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

  // Get connection info for dbType
  const connection = useConnectionStore((s) => s.getConnection(connectionId));
  const dbType = connection?.profile.db_type ?? DbType.PostgreSQL;
  const dialect = getDialectFromDbType(dbType);

  // Get supported index types for this database
  const { indexTypes, defaultType: defaultIndexType } = useSupportedIndexTypes({
    connectionId,
    dbType,
  });

  // Get table columns for the columns selector
  const { columns: tableColumns } = useTableColumns({
    connectionId,
    database,
    table,
    schema,
  });

  // Extract column names for the columns cell
  const availableColumns = useMemo(
    () => tableColumns.map((col) => col.name),
    [tableColumns],
  );

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
      const isModified = row._isModified ?? false;
      const isPrimaryKey = row.name_meta.primary;
      const isLocked = isPrimaryKey; // PK indexes cannot be edited
      const requiresRecreate = !isPending; // Existing indexes require drop+recreate for structural changes

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
        : isModified
        ? {
            bgCell: "rgba(212, 165, 43, 0.04)", // brand golden for modified
            bgCellMedium: "rgba(212, 165, 43, 0.06)",
          }
        : undefined;

      // Actions column - Delete/Undo button
      if (column.field === "actions") {
        // Don't show delete for primary key indexes
        if (isPrimaryKey) {
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

      // Editable index name cell with badges
      if (column.field === "name") {
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "editable-index-name-cell",
            name: row.name,
            isPrimary: isPrimaryKey,
            isUnique: row.name_meta.unique,
            isLocked: isLocked,
          },
          copyData: row.name,
          readonly: isLocked,
          allowOverlay: !isLocked,
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
            ...rowTheme,
            textDark: "rgba(127, 127, 127, 0.7)",
          },
        } as const;
      }

      // Unique column - editable toggle (YES/NO)
      if (column.field === "unique") {
        const uniqueValue = (
          typeof fieldValue === "string" ? fieldValue : "NO"
        ) as "YES" | "NO";
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "index-unique-cell",
            value: uniqueValue,
            requiresRecreate,
            isLocked,
          },
          copyData: uniqueValue,
          readonly: isLocked,
          allowOverlay: !isLocked,
          themeOverride: rowTheme,
        } as const;
      }

      // Columns - editable multi-select
      if (column.field === "columns") {
        const columnsArray = row.columns_array;
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "index-columns-cell",
            columns: columnsArray,
            availableColumns,
            requiresRecreate,
            isLocked,
          },
          copyData: columnsArray.join(", "),
          readonly: isLocked,
          allowOverlay: !isLocked,
          themeOverride: {
            ...rowTheme,
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      // Index type - editable dropdown
      if (column.field === "index_type") {
        const typeValue = typeof fieldValue === "string" ? fieldValue : defaultIndexType;
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "index-type-cell",
            value: typeValue,
            options: indexTypes,
            requiresRecreate,
            isLocked,
          },
          copyData: typeValue,
          readonly: isLocked,
          allowOverlay: !isLocked,
          themeOverride: rowTheme,
        } as const;
      }

      // Condition/WHERE clause - editable with SQL editor
      if (column.field === "condition") {
        const conditionValue = typeof fieldValue === "string" ? fieldValue : "";
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "index-condition-cell",
            value: conditionValue,
            requiresRecreate,
            isLocked,
            dialect,
          },
          copyData: conditionValue,
          readonly: isLocked,
          allowOverlay: !isLocked,
          themeOverride: {
            ...rowTheme,
            baseFontStyle: "400 11px monospace",
            textDark: conditionValue ? "#3b82f6" : undefined, // blue-500 when has content
          },
        } as const;
      }

      // Statistics cell with color coding (always readonly)
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
                ...rowTheme,
                bgCell: "rgba(239, 68, 68, 0.1)", // red-500 with 10% opacity
                textDark: "#dc2626", // red-600
              }
            : rowTheme,
        } as const;
      }

      // Default text cell
      const displayValue = typeof fieldValue === "string" ? fieldValue : "";
      return {
        kind: GridCellKind.Text,
        data: displayValue,
        displayData: displayValue,
        readonly: true,
        allowOverlay: false,
        themeOverride: rowTheme,
      } as const;
    },
    [gridRows, sizedColumns, availableColumns, indexTypes, defaultIndexType, dialect],
  );

  const hasIndexes = useMemo(() => indexes.length > 0, [indexes.length]);

  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      IndexNameCellRenderer as unknown as CustomRenderer<AnyCell>,
      IndexColumnsCellRenderer as unknown as CustomRenderer<AnyCell>,
      IndexTypeCellRenderer as unknown as CustomRenderer<AnyCell>,
      IndexUniqueCellRenderer as unknown as CustomRenderer<AnyCell>,
      ConditionCellRenderer as unknown as CustomRenderer<AnyCell>,
      TextSingleLineCellRenderer as unknown as CustomRenderer<AnyCell>,
    ],
    [],
  );

  // Helper to extract value from cell data
  const extractCellValue = useCallback(
    (newValue: EditableGridCell): unknown => {
      if ("data" in newValue) {
        const data = newValue.data;
        if (typeof data === "object" && data !== null) {
          // Handle editable-index-name-cell
          if (
            "name" in data &&
            (data as { kind?: string }).kind === "editable-index-name-cell"
          ) {
            return (data as { name: string }).name;
          }
          // Handle index-columns-cell
          if (
            "columns" in data &&
            (data as { kind?: string }).kind === "index-columns-cell"
          ) {
            return (data as { columns: string[] }).columns;
          }
          // Handle index-type-cell
          if (
            "value" in data &&
            (data as { kind?: string }).kind === "index-type-cell"
          ) {
            return (data as { value: string }).value;
          }
          // Handle index-unique-cell
          if (
            "value" in data &&
            (data as { kind?: string }).kind === "index-unique-cell"
          ) {
            return (data as { value: string }).value;
          }
          // Handle index-condition-cell
          if (
            "value" in data &&
            (data as { kind?: string }).kind === "index-condition-cell"
          ) {
            return (data as { value: string }).value;
          }
          // Generic value extraction
          if ("value" in data) {
            return (data as { value: unknown }).value;
          }
        }
        return data;
      }
      return null;
    },
    [],
  );

  // Handler: Add new index
  const handleAddIndex = useCallback(() => {
    const target: CrudCommandTarget = {
      connectionId,
      database,
      schema,
      table,
    };

    const tempId = generateCommandId();
    const command = createIndexCreateCommand(
      target,
      {
        name: "",
        columns: [],
        unique: false,
        using: defaultIndexType,
      },
      tempId,
    );

    stageCommand(command);
    toast.success("New index added", {
      description: "Fill in the index details and commit when ready",
    });
  }, [connectionId, database, schema, table, defaultIndexType, stageCommand]);

  // Handler: Cell edited
  const handleCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) return;

      // Skip if the row is a primary key (locked)
      if (row.name_meta.primary) return;

      const target: CrudCommandTarget = {
        connectionId,
        database,
        schema,
        table,
      };

      const extractedValue = extractCellValue(newValue);

      if (row._isPending) {
        // Update pending index.create command
        const command = pendingCommands.find(
          (cmd) =>
            cmd.type === "index.create" &&
            (cmd.payload as IndexCreatePayload).tempId === row._tempId,
        );

        if (command) {
          const payload = command.payload as IndexCreatePayload;
          const updatedDefinition = { ...payload.definition };

          if (column.field === "name") {
            updatedDefinition.name = typeof extractedValue === "string" ? extractedValue : "";
          } else if (column.field === "columns") {
            updatedDefinition.columns = Array.isArray(extractedValue)
              ? extractedValue
              : [];
          } else if (column.field === "index_type") {
            updatedDefinition.using = typeof extractedValue === "string" ? extractedValue : defaultIndexType;
          } else if (column.field === "unique") {
            updatedDefinition.unique = extractedValue === "YES";
          } else if (column.field === "condition") {
            const condValue = typeof extractedValue === "string" ? extractedValue : "";
            updatedDefinition.where = condValue || undefined;
          }

          const updatedCmd = {
            ...command,
            payload: {
              ...payload,
              definition: updatedDefinition,
            },
            metadata: {
              ...command.metadata,
              description: `Create index ${updatedDefinition.name || "(unnamed)"}`,
            },
          };

          stageCommand(updatedCmd);
        }
      } else {
        // Modify existing index
        const originalName = row._original?.name ?? row.name;

        // For name changes, use rename command
        if (column.field === "name") {
          const newName = typeof extractedValue === "string" ? extractedValue : "";
          if (!newName || newName === originalName) {
            return;
          }

          // Check for existing rename command
          const renameCommands = pendingCommands.filter((cmd) => {
            if (cmd.type !== "index.rename") return false;
            const payload = cmd.payload as { indexName?: string };
            return payload.indexName === originalName;
          });

          const existingRename = renameCommands[0];
          if (existingRename) {
            // Clean up duplicate rename commands
            renameCommands.slice(1).forEach((cmd) => {
              unstageCommand(cmd.id);
            });
            const payload = existingRename.payload as {
              indexName: string;
              newName: string;
            };
            // If renaming back to original name, remove the rename command
            if (newName === originalName) {
              unstageCommand(existingRename.id);
              return;
            }
            // Update the rename command
            if (newName !== payload.newName) {
              const updatedCmd = {
                ...existingRename,
                payload: {
                  ...payload,
                  newName,
                },
                metadata: {
                  ...existingRename.metadata,
                  description: `Rename index ${payload.indexName} to ${newName}`,
                },
              };
              stageCommand(updatedCmd);
            }
            return;
          }

          // Create new rename command
          const renameCmd = createIndexRenameCommand(target, originalName, newName);
          stageCommand(renameCmd);
          return;
        }

        // For structural changes (columns, type, unique, condition), we need to recreate
        // This involves a drop + create with a recreate tag to link them

        // Find existing drop+create pair for this index
        const recreateTag = `recreate:${originalName}`;
        const existingDropCmd = pendingCommands.find(
          (cmd) =>
            cmd.type === "index.drop" &&
            cmd.metadata.tags?.includes(recreateTag),
        );
        const existingCreateCmd = pendingCommands.find(
          (cmd) =>
            cmd.type === "index.create" &&
            cmd.metadata.tags?.includes(recreateTag),
        );

        // Get current values (from existing recreate create or original)
        const currentDef = existingCreateCmd
          ? (existingCreateCmd.payload as IndexCreatePayload).definition
          : {
              name: row._original?.name ?? row.name,
              columns: row._original?.columns ?? row.columns_array,
              unique: row._original?.unique ?? row.name_meta.unique,
              using: row._original?.index_type ?? row.index_type,
              where: row._original?.condition ?? row.condition,
            };

        // Build updated definition
        const updatedDef = { ...currentDef };
        if (column.field === "columns") {
          updatedDef.columns = Array.isArray(extractedValue) ? extractedValue : [];
        } else if (column.field === "index_type") {
          updatedDef.using = typeof extractedValue === "string" ? extractedValue : defaultIndexType;
        } else if (column.field === "unique") {
          updatedDef.unique = extractedValue === "YES";
        } else if (column.field === "condition") {
          const condValue = typeof extractedValue === "string" ? extractedValue : "";
          updatedDef.where = condValue || undefined;
        }

        // Check if the new definition matches the original (undo case)
        const original = row._original;
        const isRevertingToOriginal =
          original &&
          updatedDef.name === original.name &&
          JSON.stringify(updatedDef.columns) === JSON.stringify(original.columns) &&
          updatedDef.unique === original.unique &&
          updatedDef.using === original.index_type &&
          (updatedDef.where ?? "") === (original.condition ?? "");

        if (isRevertingToOriginal) {
          // Remove the recreate commands if reverting to original
          if (existingDropCmd) unstageCommand(existingDropCmd.id);
          if (existingCreateCmd) unstageCommand(existingCreateCmd.id);
          return;
        }

        // Create or update the drop + create pair
        if (!existingDropCmd) {
          // Create new drop command with recreate tag
          const baseDropCmd = createIndexDropCommand(target, originalName);
          const dropCmd = {
            ...baseDropCmd,
            metadata: {
              ...baseDropCmd.metadata,
              tags: [recreateTag],
            },
          };
          stageCommand(dropCmd);
        }

        if (existingCreateCmd) {
          // Update existing create command
          const updatedCreateCmd = {
            ...existingCreateCmd,
            payload: {
              ...(existingCreateCmd.payload as IndexCreatePayload),
              definition: updatedDef,
            },
            metadata: {
              ...existingCreateCmd.metadata,
              description: `Recreate index ${updatedDef.name}`,
            },
          };
          stageCommand(updatedCreateCmd);
        } else {
          // Create new create command with recreate tag
          const baseCreateCmd = createIndexCreateCommand(target, updatedDef);
          const createCmd = {
            ...baseCreateCmd,
            metadata: {
              ...baseCreateCmd.metadata,
              tags: [recreateTag],
              description: `Recreate index ${updatedDef.name}`,
            },
          };
          stageCommand(createCmd);
        }
      }
    },
    [
      sizedColumns,
      gridRows,
      connectionId,
      database,
      schema,
      table,
      pendingCommands,
      defaultIndexType,
      stageCommand,
      unstageCommand,
      extractCellValue,
    ],
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
            onAdd={handleAddIndex}
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
          onAdd={handleAddIndex}
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
            onCellEdited={handleCellEdited}
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
