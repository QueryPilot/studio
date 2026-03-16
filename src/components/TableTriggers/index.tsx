import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GridCellKind,
  type Item,
  type CustomCell,
  type CustomRenderer,
  type EditableGridCell,
  type GridMouseEventArgs,
} from "@glideapps/glide-data-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { IconAlertCircle, IconBolt } from "@tabler/icons-react";
import { databaseService, type TriggerMeta } from "@/services/databaseService";
import { DataGridBase } from "@/components/DataGrid/base/DataGridBase";
import { useColumnSizing } from "@/components/DataGrid/hooks/useColumnSizing";
import { TextSingleLineCellRenderer } from "@/components/DataGrid/renderers/TextCell";
import { triggerColumns } from "./columns";
import {
  transformTriggersToRows,
  getTriggerModifiedFields,
  type TriggerModifiedField,
} from "./utils";
import type { TriggerGridRow } from "./types";
import { useCrudStore, buildCrudTableKey } from "@/stores/crudStore";
import { useTableInvalidation } from "@/hooks/useTableInvalidation";
import {
  createTriggerDropCommand,
  createTriggerEnableCommand,
  createTriggerDisableCommand,
  createTriggerRenameCommand,
} from "./commandFactory";
import { TableActionsToolbar } from "@/components/shared/TableActionsToolbar";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";
import { GlobalChangesDialog } from "@/components/GlobalChangesDialog";
import { toast } from "sonner";
import type {
  CrudCommandTarget,
  TriggerDropPayload,
  TriggerTogglePayload,
  TriggerRenamePayload,
} from "@/types/crud";
import TriggerNameCellRenderer from "./TriggerNameCellRenderer";
import { TriggerEnabledCellRenderer } from "./TriggerEnabledCellRenderer";
import { TriggerDefinitionPreviewDialog } from "./TriggerDefinitionPreviewDialog";
import { ActionsCellRenderer } from "@/components/TableStructure/ActionsCellRenderer";
import { TriggerTableContextMenu } from "./TriggerTableContextMenu";

type AnyCell = CustomCell<Record<string, unknown>>;

interface TableTriggersProps {
  connectionId: string;
  database: string;
  table: string;
  schema?: string;
  onActionsChange?: (actions: React.ReactNode) => void;
}

export const TableTriggers = memo(function TableTriggers({
  connectionId,
  database,
  table,
  schema,
  onActionsChange: _onActionsChange,
}: TableTriggersProps) {
  const [triggers, setTriggers] = useState<TriggerMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TriggerGridRow | null>(null);
  const [globalChangesDialogOpen, setGlobalChangesDialogOpen] = useState(false);
  const [definitionPreviewOpen, setDefinitionPreviewOpen] = useState(false);
  const [previewTrigger, setPreviewTrigger] = useState<TriggerGridRow | null>(null);
  const contextMenuRowRef = useRef<TriggerGridRow | null>(null);

  // crudStore integration — scoped selectors (#16 fix)
  const stageCommand = useCrudStore((s) => s.stageCommand);
  const unstageCommand = useCrudStore((s) => s.unstageCommand);

  const tableKey = useMemo(
    () => buildCrudTableKey({ connectionId, database, schema, table }),
    [connectionId, database, schema, table],
  );

  const pendingCommands = useCrudStore((s) => s.stagedCommands.get(tableKey) ?? []);

  const loadTriggers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await databaseService.listTriggers(
        connectionId,
        database,
        schema || "public",
        table,
      );
      setTriggers(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load triggers");
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, database, schema, table]);

  useEffect(() => {
    void loadTriggers();
  }, [loadTriggers]);

  // Subscribe to data invalidation events (Cmd+S commit, Cmd+R refresh)
  useTableInvalidation(connectionId, database, schema, table, () => {
    void loadTriggers();
  });

  const hasTriggers = useMemo(() => triggers.length > 0, [triggers.length]);

  // Transform to grid rows with pending commands
  const gridRows = useMemo(
    () => transformTriggersToRows(triggers, pendingCommands),
    [triggers, pendingCommands],
  );

  const modifiedFieldsByRow = useMemo(() => {
    const map = new Map<number, Set<TriggerModifiedField>>();
    gridRows.forEach((row, index) => {
      const fields = getTriggerModifiedFields(row);
      if (fields.size > 0) {
        map.set(index, fields);
      }
    });
    return map;
  }, [gridRows]);

  // Handler: Delete trigger
  const handleDeleteTrigger = useCallback(
    (row: TriggerGridRow) => {
      const target: CrudCommandTarget = {
        connectionId,
        database,
        schema,
        table,
      };
      const originalName = row._original.name;
      const command = createTriggerDropCommand(target, originalName);
      stageCommand(command);
      toast.success("Trigger deletion staged", {
        description: `${originalName} will be dropped when committed`,
      });
      setDeleteDialogOpen(false);
      setDeleteTarget(null);
    },
    [connectionId, database, schema, table, stageCommand],
  );

  // Enable column resizing
  const { sizedColumns, handleColumnResize, handleColumnResizeEnd } =
    useColumnSizing({
      columns: triggerColumns,
      initialWidths: {},
      onChange: () => {},
    });

  // Helper to extract value from cell data
  const extractCellValue = useCallback(
    (newValue: EditableGridCell): unknown => {
      if ("data" in newValue) {
        const data = newValue.data;
        if (typeof data === "object" && data !== null) {
          // Handle trigger-name-cell
          if (
            "name" in data &&
            (data as { kind?: string }).kind === "trigger-name-cell"
          ) {
            return (data as { name: string }).name;
          }
          // Handle trigger-enabled-cell
          if (
            "value" in data &&
            (data as { kind?: string }).kind === "trigger-enabled-cell"
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

      const extractedValue = extractCellValue(newValue);
      const originalName = row._original.name;

      // Handle name changes (rename)
      if (column.field === "name") {
        const newName = typeof extractedValue === "string" ? extractedValue : "";
        if (!newName || newName === originalName) {
          return;
        }

        // Check for existing rename command
        const existingRename = pendingCommands.find(
          (cmd) =>
            cmd.type === "trigger.rename" &&
            (cmd.payload as TriggerRenamePayload).triggerName === originalName,
        );

        if (existingRename) {
          // If renaming back to original name, remove the rename command
          if (newName === originalName) {
            unstageCommand(existingRename.id);
            return;
          }
          // Update the rename command
          const payload = existingRename.payload as TriggerRenamePayload;
          if (newName !== payload.newName) {
            const updatedCmd = {
              ...existingRename,
              payload: {
                ...payload,
                newName,
              },
              metadata: {
                ...existingRename.metadata,
                description: `Rename trigger ${payload.triggerName} to ${newName}`,
              },
            };
            stageCommand(updatedCmd);
          }
          return;
        }

        // Create new rename command
        const renameCmd = createTriggerRenameCommand(target, originalName, newName);
        stageCommand(renameCmd);
        return;
      }

      // Handle enabled changes (toggle)
      if (column.field === "enabled") {
        const newEnabled = extractedValue === "YES";
        const originalEnabled = row._original.enabled;

        // Check for existing toggle command
        const existingToggle = pendingCommands.find(
          (cmd) =>
            (cmd.type === "trigger.enable" || cmd.type === "trigger.disable") &&
            (cmd.payload as TriggerTogglePayload).triggerName === originalName,
        );

        if (existingToggle) {
          // If toggling back to original state, remove the toggle command
          if (newEnabled === originalEnabled) {
            unstageCommand(existingToggle.id);
            return;
          }
          // Replace with new toggle command
          unstageCommand(existingToggle.id);
        }

        // Don't create command if same as original
        if (newEnabled === originalEnabled) {
          return;
        }

        // Create new toggle command
        const toggleCmd = newEnabled
          ? createTriggerEnableCommand(target, originalName)
          : createTriggerDisableCommand(target, originalName);
        stageCommand(toggleCmd);
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
      unstageCommand,
      extractCellValue,
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

      const fieldValue = row[column.field as keyof TriggerGridRow];
      const isPendingDelete = row._isPendingDelete ?? false;
      const isModified = row._isModified ?? false;

      // Row background - visual indicators for pending states
      const rowTheme = isPendingDelete
        ? {
            bgCell: "rgba(239, 68, 68, 0.06)", // red for pending delete
            bgCellMedium: "rgba(239, 68, 68, 0.08)",
            accentColor: "rgba(239, 68, 68, 0.4)",
            accentLight: "rgba(239, 68, 68, 0.15)",
            textDark: "#dc2626",
          }
        : isModified
        ? {
            bgCell: "rgba(212, 165, 43, 0.04)", // brand golden for modified
            bgCellMedium: "rgba(212, 165, 43, 0.06)",
            accentColor: "#D4A52B",
            accentLight: "rgba(212, 165, 43, 0.12)",
          }
        : undefined;

      const modifiedFields = modifiedFieldsByRow.get(rowIndex);
      const isCellModified =
        !isPendingDelete &&
        Boolean(modifiedFields?.has(column.field as TriggerModifiedField));
      const cellThemeOverride = isCellModified
        ? {
            ...(rowTheme ?? {}),
            bgCell: "rgba(251, 146, 60, 0.15)", // orange highlight
            accentColor: "#fb923c",
            accentLight: "rgba(251, 146, 60, 0.2)",
          }
        : rowTheme;

      // Actions column - Delete/Undo button (uses ActionsCellRenderer)
      if (column.field === "actions") {
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "actions-cell",
            isPendingDelete: isPendingDelete,
          },
          copyData: "",
          readonly: true,
          allowOverlay: false,
          themeOverride: cellThemeOverride,
        } as const;
      }

      // Helper to safely stringify field values
      const safeStringify = (val: unknown): string => {
        if (val == null) return "";
        if (typeof val === "object") return JSON.stringify(val);
        if (typeof val === "string") return val;
        if (typeof val === "number" || typeof val === "boolean") {
          return val.toString();
        }
        return "";
      };

      // Make all cells readonly when row is pending delete
      if (isPendingDelete) {
        const displayValue = safeStringify(fieldValue);
        return {
          kind: GridCellKind.Text,
          data: displayValue,
          displayData: displayValue,
          readonly: true,
          allowOverlay: false,
          themeOverride: cellThemeOverride,
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
            ...(cellThemeOverride ?? {}),
            textDark: "rgba(127, 127, 127, 0.7)",
          },
        } as const;
      }

      // Editable trigger name cell
      if (column.field === "name") {
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "trigger-name-cell",
            name: row.name,
            isLocked: false,
          },
          copyData: row.name,
          readonly: false,
          allowOverlay: true,
          themeOverride: cellThemeOverride,
        } as const;
      }

      // Enabled column - editable toggle (YES/NO)
      if (column.field === "enabled") {
        const enabledValue = (
          typeof fieldValue === "string" ? fieldValue : "NO"
        ) as "YES" | "NO";
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "trigger-enabled-cell",
            value: enabledValue,
            isLocked: false,
          },
          copyData: enabledValue,
          readonly: false,
          allowOverlay: true,
          themeOverride: cellThemeOverride,
        } as const;
      }

      // Event and Function columns (monospace) - read-only
      if (column.field === "event" || column.field === "function") {
        const value = safeStringify(fieldValue);
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "text-single-cell",
            value: value || null,
          },
          copyData: value,
          readonly: true,
          allowOverlay: true,
          themeOverride: {
            ...(cellThemeOverride ?? {}),
            baseFontStyle: "400 11px monospace",
          },
        } as const;
      }

      // Definition column (monospace with blue color) - read-only, opens preview on double-click
      if (column.field === "definition") {
        const definitionValue = safeStringify(fieldValue);
        return {
          kind: GridCellKind.Custom,
          data: {
            kind: "text-single-cell",
            value: definitionValue || null,
          },
          copyData: definitionValue,
          readonly: true,
          allowOverlay: true,
          themeOverride: {
            ...(cellThemeOverride ?? {}),
            baseFontStyle: "400 11px monospace",
            textDark: definitionValue ? "#3b82f6" : undefined, // blue-500 when has content
          },
        } as const;
      }

      // Default text cell
      const displayValue = safeStringify(fieldValue);
      return {
        kind: GridCellKind.Text,
        data: displayValue,
        displayData: displayValue,
        readonly: true,
        allowOverlay: false,
        themeOverride: cellThemeOverride,
      } as const;
    },
    [gridRows, sizedColumns, modifiedFieldsByRow],
  );

  const customRenderers = useMemo<CustomRenderer<AnyCell>[]>(
    () => [
      TriggerNameCellRenderer as unknown as CustomRenderer<AnyCell>,
      TriggerEnabledCellRenderer as unknown as CustomRenderer<AnyCell>,
      TextSingleLineCellRenderer as unknown as CustomRenderer<AnyCell>,
      ActionsCellRenderer as unknown as CustomRenderer<AnyCell>,
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
        if (row._isPendingDelete) {
          // Undo pending delete
          const dropCommand = pendingCommands.find(
            (cmd) =>
              cmd.type === "trigger.drop" &&
              (cmd.payload as TriggerDropPayload).triggerName === row._original.name,
          );
          if (dropCommand) {
            unstageCommand(dropCommand.id);
            toast.success("Delete undone", {
              description: `${row._original.name} will no longer be dropped`,
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

  // Handle cell activation (double-click) for definition preview
  const handleCellActivated = useCallback(
    (cell: Item) => {
      const [colIndex, rowIndex] = cell;
      const column = sizedColumns[colIndex];
      const row = gridRows[rowIndex];

      if (!column || !row) return;

      // Open definition preview on double-click
      if (column.field === "definition" && row.definition) {
        setPreviewTrigger(row);
        setDefinitionPreviewOpen(true);
      }
    },
    [sizedColumns, gridRows],
  );

  // Context menu: hover tracking
  const handleItemHovered = useCallback(
    (args: GridMouseEventArgs) => {
      if (args.kind === "cell") {
        contextMenuRowRef.current = gridRows[args.location[1]] ?? null;
      } else {
        contextMenuRowRef.current = null;
      }
    },
    [gridRows],
  );

  // Context menu: toggle enabled/disabled
  const handleContextToggleEnabled = useCallback(
    (row: TriggerGridRow) => {
      const target: CrudCommandTarget = { connectionId, database, schema, table };
      const originalName = row._original.name;
      const currentlyEnabled = row.enabled === "YES";
      const originalEnabled = row._original.enabled;

      // Check for existing toggle command
      const existingToggle = pendingCommands.find(
        (cmd) =>
          (cmd.type === "trigger.enable" || cmd.type === "trigger.disable") &&
          (cmd.payload as TriggerTogglePayload).triggerName === originalName,
      );

      if (existingToggle) {
        // Toggling back to original state — remove the command
        if (!currentlyEnabled === originalEnabled) {
          unstageCommand(existingToggle.id);
          return;
        }
        // Replace with new toggle command
        unstageCommand(existingToggle.id);
      }

      // Don't create command if same as original
      if (!currentlyEnabled === originalEnabled) {
        return;
      }

      const toggleCmd = currentlyEnabled
        ? createTriggerDisableCommand(target, originalName)
        : createTriggerEnableCommand(target, originalName);
      stageCommand(toggleCmd);
    },
    [connectionId, database, schema, table, pendingCommands, stageCommand, unstageCommand],
  );

  // Context menu: undo delete
  const handleContextUndoDelete = useCallback(
    (row: TriggerGridRow) => {
      const dropCommand = pendingCommands.find(
        (cmd) =>
          cmd.type === "trigger.drop" &&
          (cmd.payload as TriggerDropPayload).triggerName === row._original.name,
      );
      if (dropCommand) {
        unstageCommand(dropCommand.id);
        toast.success("Delete undone", {
          description: `${row._original.name} will no longer be dropped`,
        });
      }
    },
    [pendingCommands, unstageCommand],
  );

  // Context menu: show delete confirmation
  const handleContextShowDeleteConfirm = useCallback(
    (row: TriggerGridRow) => {
      setDeleteTarget(row);
      setDeleteDialogOpen(true);
    },
    [],
  );

  if (isLoading) {
    return <TableTriggersSkeleton />;
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 select-text">
        <IconAlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h3 className="text-lg font-semibold mb-2">Failed to load triggers</h3>
        <p className="text-xs text-muted-foreground max-w-md text-center select-text">
          {error}
        </p>
      </div>
    );
  }

  // Count pending trigger commands
  const pendingTriggerCommands = pendingCommands.filter(
    (cmd) => cmd.type.startsWith("trigger."),
  );

  if (!hasTriggers && pendingTriggerCommands.length === 0) {
    return (
      <>
        <div className="h-full flex flex-col">
          <TableActionsToolbar
            onReviewChanges={() => {
              setGlobalChangesDialogOpen(true);
            }}
            pendingChangesCount={pendingTriggerCommands.length}
          />
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <IconBolt className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-xs">This table has no triggers.</p>
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
            loadTriggers().catch(() => undefined);
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className="h-full flex flex-col">
        <TableActionsToolbar
          onReviewChanges={() => {
            setGlobalChangesDialogOpen(true);
          }}
          pendingChangesCount={pendingTriggerCommands.length}
        />
        <div className="flex-1">
          <TriggerTableContextMenu
            hoveredRowRef={contextMenuRowRef}
            onToggleEnabled={handleContextToggleEnabled}
            onUndoDelete={handleContextUndoDelete}
            onShowDeleteConfirm={handleContextShowDeleteConfirm}
          >
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
              onCellActivated={handleCellActivated}
              onItemHovered={handleItemHovered}
            />
          </TriggerTableContextMenu>
        </div>
        <div className="px-4 py-2 text-xs text-muted-foreground border-t">
          Total triggers: {triggers.length}
          <button
            type="button"
            onClick={() => loadTriggers().catch(() => undefined)}
            className="ml-4 text-primary hover:underline"
          >
            Refresh
          </button>
        </div>
      </div>

      <ConfirmDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Drop Trigger"
        description="Are you sure you want to drop this trigger? This action cannot be undone."
        entityName={deleteTarget?._original.name}
        onConfirm={() => {
          if (deleteTarget) {
            handleDeleteTrigger(deleteTarget);
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
          loadTriggers().catch(() => undefined);
        }}
      />

      <TriggerDefinitionPreviewDialog
        open={definitionPreviewOpen}
        onOpenChange={setDefinitionPreviewOpen}
        triggerName={previewTrigger?.name ?? ""}
        definition={previewTrigger?.definition ?? ""}
      />
    </>
  );
});

const TableTriggersSkeleton = memo(function TableTriggersSkeleton() {
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-4 mb-4">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-5 w-28" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
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

export default TableTriggers;
