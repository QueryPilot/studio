import { logger } from "@/lib/logger";
import { memo, useMemo, useCallback, useState } from "react";
import {
  GridCellKind,
  type Item,
  type CustomCell,
  type CustomRenderer,
  type EditableGridCell,
} from "@glideapps/glide-data-grid";
import { useTableFullStructure } from "@/hooks/useTableFullStructure";
import { Skeleton } from "@/components/ui/skeleton";
import { IconAlertCircle } from "@tabler/icons-react";
import { DataGridBase } from "@/components/DataGrid/base/DataGridBase";
import { useColumnSizing } from "@/components/DataGrid/hooks/useColumnSizing";
import { TextSingleLineCellRenderer } from "@/components/DataGrid/renderers/TextCell";
import { NullableCellRenderer } from "./NullableCellRenderer";
import { DataTypeCellRenderer } from "./DataTypeCellRenderer";
import { structureColumns } from "./columns";
import { transformStructureToRows } from "./utils";
import ColumnNameCellRenderer from "./ColumnNameCellRenderer";
import type { StructureGridRow } from "./types";
import { validateColumnName } from "./types";
import { useCrudStore, buildCrudTableKey } from "@/stores/crudStore";
import {
  createColumnAddCommand,
  createColumnModifyCommand,
  createColumnDropCommand,
  createColumnRenameCommand,
  generateCommandId,
} from "./commandFactory";
import { TableActionsToolbar } from "@/components/shared/TableActionsToolbar";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";
import { GlobalChangesDialog } from "@/components/GlobalChangesDialog";
import { toast } from "sonner";
import type { CrudCommandTarget, ColumnAddPayload, ColumnDropPayload } from "@/types/crud";

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

  const { stagedCommands, stageCommand, unstageCommand } = useCrudStore();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StructureGridRow | null>(
    null,
  );
  const [globalChangesDialogOpen, setGlobalChangesDialogOpen] = useState(false);

  const columns = useMemo(() => structure?.columns ?? [], [structure?.columns]);
  const foreignKeys = useMemo(
    () => structure?.foreignKeys ?? [],
    [structure?.foreignKeys],
  );
  const constraints = useMemo(
    () => structure?.constraints ?? [],
    [structure?.constraints],
  );

  // Get pending commands for this table - FIX: subscribe to stagedCommands directly
  const tableKey = useMemo(
    () => buildCrudTableKey({ connectionId, database, schema, table }),
    [connectionId, database, schema, table],
  );

  const pendingCommands = useMemo(() => {
    return stagedCommands.get(tableKey) ?? [];
  }, [stagedCommands, tableKey]);

  // Collect custom/enum types from existing columns
  const customTypes = useMemo(() => {
    const types = new Set<string>();
    columns.forEach((col) => {
      if (col.type_category === "enum" || col.enum_values) {
        types.add(col.db_type);
      }
    });
    return Array.from(types);
  }, [columns]);

  // Collect existing column names for validation (includes pending adds)
  const existingColumnNames = useMemo(() => {
    const names = columns.map((col) => col.name);
    // Also include pending column additions
    pendingCommands
      .filter((cmd) => cmd.type === "column.add")
      .forEach((cmd) => {
        const colName = (cmd.payload as ColumnAddPayload).column.name;
        if (colName) names.push(colName);
      });
    return names;
  }, [columns, pendingCommands]);

  // Transform to grid rows (includes pending additions)
  const gridRows = useMemo(
    () =>
      transformStructureToRows(
        columns,
        foreignKeys,
        constraints,
        pendingCommands,
      ),
    [columns, foreignKeys, constraints, pendingCommands],
  );

  // Enable column resizing
  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: structureColumns,
      initialWidths: {},
      onChange: () => {},
    });

  // Handler: Add new column
  const handleAddColumn = useCallback(() => {
    const target: CrudCommandTarget = {
      connectionId,
      database,
      schema,
      table,
    };

    const tempId = generateCommandId();
    const command = createColumnAddCommand(
      target,
      {
        name: "",
        dataType: "text",
        nullable: true,
      },
      tempId,
    );

    stageCommand(command);
    toast.success("New column added", {
      description: "Fill in the column details and commit when ready",
    });
  }, [connectionId, database, schema, table, stageCommand]);

  // Handler: Delete column
  const handleDeleteColumn = useCallback(
    (row: StructureGridRow) => {
      if (row._isPending) {
        // Remove pending add command
        const command = pendingCommands.find(
          (cmd) =>
            cmd.type === "column.add" &&
            (cmd.payload as ColumnAddPayload).tempId === row._tempId,
        );
        if (command) {
          unstageCommand(command.id);
          toast.success("Pending column removed");
        }
      } else {
        // Stage drop command for existing column
        const target: CrudCommandTarget = {
          connectionId,
          database,
          schema,
          table,
        };
        const command = createColumnDropCommand(target, row.column_name);
        stageCommand(command);
        toast.success("Column deletion staged", {
          description: `${row.column_name} will be dropped when committed`,
        });
      }
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    },
    [
      connectionId,
      database,
      schema,
      table,
      pendingCommands,
      stageCommand,
      unstageCommand,
    ],
  );

  // Helper to extract value from cell data
  const extractCellValue = useCallback(
    (newValue: EditableGridCell): string | boolean | null => {
      if ("data" in newValue) {
        const data = newValue.data;
        if (typeof data === "object" && data !== null && "value" in data) {
          return (data as { value: string | boolean | null }).value;
        }
        return data as string | boolean | null;
      }
      return null;
    },
    [],
  );

  // Handler: Cell edited
  const handleCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) return;

      const target: CrudCommandTarget = {
        connectionId,
        database,
        schema,
        table,
      };

      // Extract value from cell
      const extractedValue = extractCellValue(newValue);

      // Validate column name changes
      if (column.field === "column_name" && typeof extractedValue === "string") {
        const currentColumnName = row._isPending
          ? undefined // New columns don't have an existing name to exclude
          : row._original?.name;
        const validation = validateColumnName(
          extractedValue,
          existingColumnNames,
          currentColumnName,
        );
        if (!validation.valid) {
          toast.error("Invalid column name", {
            description: validation.error,
          });
          return;
        }
      }

      if (row._isPending) {
        // Update pending column.add command
        const command = pendingCommands.find(
          (cmd) =>
            cmd.type === "column.add" &&
            (cmd.payload as ColumnAddPayload).tempId === row._tempId,
        );

        if (command) {
          const payload = command.payload as ColumnAddPayload;
          const updatedColumn = { ...payload.column };

          if (column.field === "column_name") {
            updatedColumn.name = String(extractedValue ?? "");
          } else if (column.field === "db_type") {
            updatedColumn.dataType = String(extractedValue ?? "text");
          } else if (column.field === "nullable") {
            updatedColumn.nullable = extractedValue === "YES";
          } else if (column.field === "default") {
            updatedColumn.defaultValue = extractedValue;
          } else if (column.field === "comment") {
            updatedColumn.comment = String(extractedValue ?? "");
          }

          const updatedCmd = {
            ...command,
            payload: {
              ...payload,
              column: updatedColumn,
            },
          };

          stageCommand(updatedCmd);
        }
      } else {
        // Modify existing column
        if (column.field === "column_name") {
          // Column rename - use rename command
          const newName = String(extractedValue ?? "");
          if (newName && newName !== row.column_name) {
            const renameCmd = createColumnRenameCommand(
              target,
              row.column_name,
              newName,
            );
            stageCommand(renameCmd);
          }
        } else {
          // Other field changes - use modify command
          const newDefinition: Record<string, unknown> = {};

          if (column.field === "nullable") {
            newDefinition.nullable = extractedValue === "YES";
            logger.info("[TableStructure] Nullable change:", {
              extractedValue,
              nullable: newDefinition.nullable,
            });
          } else if (column.field === "default") {
            newDefinition.defaultValue = extractedValue;
          } else if (column.field === "comment") {
            newDefinition.comment = extractedValue;
          } else if (column.field === "db_type") {
            newDefinition.dataType = extractedValue;
          }

          logger.info("[TableStructure] Creating modify command:", {
            columnName: row.column_name,
            newDefinition,
          });
          const modifyCmd = createColumnModifyCommand(
            target,
            row.column_name,
            newDefinition,
          );
          logger.info("[TableStructure] Modify command created:", modifyCmd);
          stageCommand(modifyCmd);
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
      stageCommand,
      extractCellValue,
      existingColumnNames,
    ],
  );

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
      const isPending = row._isPending ?? false;
      const isModified = row._isModified ?? false;
      const isPendingDelete = row._isPendingDelete ?? false;

      // Row background - match TableDataGrid colors with priority order
      const rowTheme = isPendingDelete
        ? {
            bgCell: "rgba(239, 68, 68, 0.08)", // red-500 for pending delete
            bgCellMedium: "rgba(239, 68, 68, 0.12)",
            accentColor: "rgba(239, 68, 68, 0.4)",
            accentLight: "rgba(239, 68, 68, 0.15)",
            textDark: "#dc2626", // red text
          }
        : isPending
        ? {
            bgCell: "rgba(34, 197, 94, 0.06)", // green-500 for new columns
            bgCellMedium: "rgba(34, 197, 94, 0.08)",
            accentColor: "rgba(34, 197, 94, 0.4)",
            accentLight: "rgba(34, 197, 94, 0.15)",
          }
        : isModified
        ? {
            bgCell: "rgba(212, 165, 43, 0.04)", // brand golden for modified columns
            bgCellMedium: "rgba(212, 165, 43, 0.06)",
            accentColor: "#D4A52B",
            accentLight: "rgba(212, 165, 43, 0.12)",
          }
        : undefined;

      // Actions column - Delete/Undo button
      if (column.field === "actions") {
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
        const displayValue =
          typeof fieldValue === "object" ? JSON.stringify(fieldValue) : String(fieldValue ?? "");
        return {
          kind: GridCellKind.Text,
          data: displayValue,
          displayData: displayValue,
          readonly: true,
          allowOverlay: false,
          themeOverride: rowTheme,
        } as const;
      }

      // Column name - editable for all rows (pending and existing)
      if (column.field === "column_name") {
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "text-single-cell",
            value: row.column_name || null,
            isPrimaryKey: row.column_meta.is_pk,
            isForeignKey: row.column_meta.is_fk,
          },
          copyData: row.column_name,
          readonly: false, // Allow editing for all rows
          allowOverlay: true,
          themeOverride: rowTheme,
        } as const;
      }

      // Row number (right-aligned, muted)
      if (column.field === "row_number") {
        const rowNum = typeof fieldValue === "number" ? fieldValue : 0;
        return {
          kind: GridCellKind.Text,
          data: String(rowNum),
          displayData: String(rowNum),
          readonly: true,
          allowOverlay: false,
          contentAlign: "right" as const,
          themeOverride: {
            ...rowTheme,
            textDark: "rgba(127, 127, 127, 0.7)",
          },
        } as const;
      }

      // Nullable - YES/NO dropdown
      if (column.field === "nullable") {
        const nullableValue = (typeof fieldValue === "string" ? fieldValue : "NO") as "YES" | "NO";
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "nullable-cell",
            value: nullableValue,
            columnName: row.column_name,
          },
          copyData: nullableValue,
          readonly: false,
          allowOverlay: true,
          contentAlign: "center" as const,
          themeOverride: rowTheme,
        } as const;
      }

      // Type - data type dropdown - editable for all rows
      if (column.field === "db_type") {
        const typeValue = typeof fieldValue === "string" ? fieldValue : "text";
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "datatype-cell",
            value: typeValue,
            customTypes: customTypes,
            columnName: row.column_name,
          },
          copyData: typeValue,
          readonly: false, // Allow editing for all rows
          allowOverlay: true,
          themeOverride: rowTheme,
        } as const;
      }

      // Default, Comment - editable
      if (column.field === "default" || column.field === "comment") {
        // Keep null/undefined as-is - don't convert to empty string
        const value = typeof fieldValue === "string" ? fieldValue : null;
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "text-single-cell",
            value: value,
          },
          copyData: value ?? "",
          readonly: false,
          allowOverlay: true,
          themeOverride: {
            ...rowTheme,
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      // Foreign IconKey, IconCheck - read-only
      if (
        column.field === "foreign_key" ||
        column.field === "check_constraint"
      ) {
        const value = typeof fieldValue === "string" ? fieldValue : "";
        return {
          kind: GridCellKind.Text,
          data: value,
          displayData: value,
          readonly: true,
          allowOverlay: true,
          themeOverride: {
            ...rowTheme,
            baseFontStyle: "400 11px monospace",
          },
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
    [gridRows, sizedColumns, customTypes],
  );

  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      TextSingleLineCellRenderer as unknown as CustomRenderer<AnyCell>,
      ColumnNameCellRenderer as unknown as CustomRenderer<AnyCell>,
      NullableCellRenderer as unknown as CustomRenderer<AnyCell>,
      DataTypeCellRenderer as unknown as CustomRenderer<AnyCell>,
    ],
    [],
  );

  const handleCellClick = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) return;

      // Handle action button click
      if (column.field === "actions") {
        if (row._isPendingDelete) {
          // Undo pending delete - find and unstage the drop command
          const dropCommand = pendingCommands.find(
            (cmd) =>
              cmd.type === "column.drop" &&
              (cmd.payload as ColumnDropPayload).columnName === row._original?.name,
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
    return <TableStructureSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 select-text">
        <IconAlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load structure</h3>
        <p className="text-xs text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  if (columns.length === 0 && pendingCommands.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-xs">No columns available for this object.</p>
      </div>
    );
  }

  return (
    <>
      <div className="h-full flex flex-col">
        <TableActionsToolbar
          addButtonLabel="Add Column"
          onAdd={handleAddColumn}
          onReviewChanges={() => { setGlobalChangesDialogOpen(true); }}
          pendingChangesCount={pendingCommands.length}
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
            onCellEdited={handleCellEdited}
            onCellClicked={handleCellClick}
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

      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete Column"
        description="Are you sure you want to delete this column? This action cannot be undone and all data in this column will be permanently lost."
        entityName={deleteTarget?.column_name}
        onConfirm={() => {
          if (deleteTarget) {
            handleDeleteColumn(deleteTarget);
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
          refresh().catch(() => undefined);
        }}
      />
    </>
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
