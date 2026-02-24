import { logger } from "@/lib/logger";
import { useState, useMemo, useCallback, useEffect, useRef, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCrudStore } from "@/stores/crudStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import type { CrudCommand, CrudCommandPayload } from "@/types/crud";
import { DbType } from "@/types/connection";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { useValidationStore } from "@/stores/validationStore";
import { getOperationExecutor } from "@/services/operationExecutors";
import { CodeEditor, type SqlDialect } from "@/components/CodeEditor";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconCircleCheckFilled,
  IconX,
  IconLoader2,
  IconArrowBackUp,
  IconAlertTriangle,
  IconCode,
  IconList,
  IconCopy,
  IconCheck,
  IconRefresh,
  IconShieldCheck,
  IconChevronLeft,
  IconTable,
} from "@tabler/icons-react";
import { toast } from "sonner";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { useTheme } from "next-themes";
import { writeClipboardText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

// Map DbType to SqlDialect for CodeEditor (SQL databases only)
const dbTypeToDialect: Record<DbType, SqlDialect> = {
  [DbType.PostgreSQL]: "postgresql",
  [DbType.MySQL]: "mysql",
  [DbType.MariaDB]: "mysql", // MariaDB uses MySQL syntax
  [DbType.SQLite]: "sqlite",
  [DbType.SQLServer]: "mssql",
  [DbType.MongoDB]: "postgresql",
  [DbType.Redis]: "postgresql",
};

const isNoSqlDatabase = (dbType: DbType): boolean =>
  dbType === DbType.MongoDB || dbType === DbType.Redis;

interface GlobalChangesDialogProps {
  connectionId: string;
  database?: string;
  schema?: string;
  table?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommitSuccess?: () => void;
}

export function GlobalChangesDialog(props: GlobalChangesDialogProps) {
  const {
    connectionId,
    database,
    schema,
    table,
    open,
    onOpenChange,
    onCommitSuccess,
  } = props;
  
  // Use selective zustand subscriptions to avoid unnecessary re-renders
  // Only subscribe to the parts of the store we actually need
  const stagedCommands = useCrudStore((state) => state.stagedCommands);
  const commitAll = useCrudStore((state) => state.commitAll);
  const discardAll = useCrudStore((state) => state.discardAll);
  const getTableKey = useCrudStore((state) => state.getTableKey);
  const commitChanges = useCrudStore((state) => state.commitChanges);
  const discardChanges = useCrudStore((state) => state.discardChanges);
  const unstageCommand = useCrudStore((state) => state.unstageCommand);
  const clearCommittedChanges = useCrudStore((state) => state.clearCommittedChanges);
  const isCommittingAll = useCrudStore((state) => state.isCommittingAll);

  // Local committing state for dialog-initiated commits
  const [isCommittingLocal, setIsCommittingLocal] = useState(false);
  // Combined: either dialog is committing OR global Cmd+S is committing
  const isCommitting = isCommittingLocal || isCommittingAll;
  const [viewMode, setViewMode] = useState<"changes" | "sql">("changes");
  const [copiedSql, setCopiedSql] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  // Selected table in sidebar (null = show all tables)
  const [selectedTableKey, setSelectedTableKey] = useState<string | null>(null);

  // Get connection for database type
  const { getConnection } = useConnectionStore();
  const connection = getConnection(connectionId);
  const dbType: DbType =
    (connection?.profile?.db_type as DbType) ?? DbType.PostgreSQL;

  // Validation store for checking errors
  const { canCommit } = useValidationStore();

  // Check if this is table-specific or workspace-wide
  const isTableSpecific = database !== undefined && table !== undefined;

  // Filter commands based on scope - memoize to prevent unnecessary recalculations
  // Skip computation if dialog is not open for better performance
  const connectionCommands = useMemo(() => {
    if (!open) {
      return [];
    }
    
    return Array.from(stagedCommands.entries()).filter(([tableKey]) => {
      if (isTableSpecific) {
        const specificTableKey = getTableKey({
          connectionId,
          database: database,
          schema,
          table: table,
        });
        return tableKey === specificTableKey;
      }
      // In workspace-wide mode: if connectionId is provided, filter by it
      // Otherwise show all staged commands
      if (connectionId) {
        return tableKey.startsWith(`${connectionId}:`);
      }
      return true;
    });
  }, [
    open,
    stagedCommands,
    isTableSpecific,
    connectionId,
    database,
    schema,
    table,
    getTableKey,
  ]);

  // Keep parent open state in sync when undo/discard removes every staged command.
  // Without this, the dialog unmounts while `open` stays true and reappears on next edit.
  useEffect(() => {
    if (open && connectionCommands.length === 0) {
      onOpenChange(false);
    }
  }, [open, connectionCommands.length, onOpenChange]);

  // Group commands by row ID only, preserving user edit order
  const groupedByRow = useMemo(() => {
    // Collect all commands with metadata
    const allCommands: Array<{
      tableName: string;
      command: CrudCommand;
    }> = [];

    for (const [tableKey, commands] of connectionCommands) {
      const parts = tableKey.split(":");
      const tableName = parts[parts.length - 1];
      const schemaName = parts.length > 3 ? parts[2] : undefined;
      const displayName = schemaName
        ? `${schemaName}.${tableName}`
        : tableName || "";

      for (const cmd of commands) {
        allCommands.push({
          tableName: displayName,
          command: cmd,
        });
      }
    }

    // Group by row key while preserving order
    const rowMap = new Map<string, CrudCommand[]>();
    const rowOrder: Array<{ rowKey: string; tableName: string }> = [];

    for (const { tableName, command } of allCommands) {
      let rowKey: string;

      if (command.type === "data.insert") {
        rowKey = `insert-${command.id}`;
      } else if (command.type === "data.update") {
        const payload = command.payload as {
          primaryKeys?: Record<string, unknown>;
        };
        rowKey = payload.primaryKeys
          ? JSON.stringify(payload.primaryKeys)
          : `update-${command.id}`;
      } else if (command.type === "data.delete") {
        const payload = command.payload as {
          primaryKeys?: Record<string, unknown>;
        };
        rowKey = payload.primaryKeys
          ? JSON.stringify(payload.primaryKeys)
          : `delete-${command.id}`;
      } else {
        rowKey = command.id;
      }

      if (!rowMap.has(rowKey)) {
        rowMap.set(rowKey, []);
        rowOrder.push({ rowKey, tableName });
      }

      rowMap.get(rowKey)!.push(command);
    }

    // Build final result array
    const result = rowOrder.map(({ rowKey, tableName }) => ({
      rowKey,
      tableName,
      commands: rowMap.get(rowKey) ?? [],
    }));

    logger.info("[GlobalChangesDialog] groupedByRow computed:", {
      connectionCommandsCount: connectionCommands.length,
      allCommandsCount: allCommands.length,
      resultCount: result.length,
    });

    return result;
  }, [connectionCommands]);

  // Per-table summaries for sidebar navigation
  const tableSummaries = useMemo(() => {
    return connectionCommands.map(([tableKey, commands]) => {
      const parts = tableKey.split(":");
      const tableName = parts[parts.length - 1] ?? "unknown";
      const schemaName = parts.length > 3 ? parts[2] : undefined;
      const displayName = schemaName
        ? `${schemaName}.${tableName}`
        : tableName;
      const inserts = commands.filter((c) => c.type === "data.insert").length;
      const updates = commands.filter((c) => c.type === "data.update").length;
      const deletes = commands.filter((c) => c.type === "data.delete").length;
      const ddl = commands.length - inserts - updates - deletes;
      return { tableKey, displayName, total: commands.length, inserts, updates, deletes, ddl };
    });
  }, [connectionCommands]);

  // Filter groupedByRow when a specific table is selected in the sidebar
  const filteredGroupedByRow = useMemo(() => {
    if (!selectedTableKey) return groupedByRow;
    return groupedByRow.filter((row) => {
      // Match by tableName (display name includes schema prefix)
      const summary = tableSummaries.find((s) => s.tableKey === selectedTableKey);
      return summary ? row.tableName === summary.displayName : true;
    });
  }, [groupedByRow, selectedTableKey, tableSummaries]);

  // Calculate total change count
  const totalChanges = connectionCommands.reduce(
    (sum, [, commands]) => sum + commands.length,
    0,
  );

  // Calculate validation errors across all tables in scope
  const validationStatus = useMemo(() => {
    const tableKeys = connectionCommands.map(([tableKey]) => tableKey);
    let totalErrors = 0;
    const tableErrorMap: Record<string, number> = {};

    for (const tableKey of tableKeys) {
      const { allowed, errorCount } = canCommit(tableKey);
      if (!allowed) {
        totalErrors += errorCount;
        const parts = tableKey.split(":");
        const tableName = parts[parts.length - 1] ?? "unknown";
        const schemaName = parts.length > 3 ? parts[2] : undefined;
        const displayName = schemaName
          ? `${schemaName}.${tableName}`
          : tableName;
        tableErrorMap[displayName] = errorCount;
      }
    }

    return {
      canCommitAll: totalErrors === 0,
      totalErrors,
      tableErrors: tableErrorMap,
    };
  }, [connectionCommands, canCommit]);

  // Generate SQL from staged commands (async)
  const [generatedSQL, setGeneratedSQL] = useState<string>("-- Loading...");

  useEffect(() => {
    if (isNoSqlDatabase(dbType)) {
      setGeneratedSQL(
        `-- SQL preview not available for ${dbType === DbType.MongoDB ? "MongoDB" : "Redis"}\n-- Changes will be applied using native ${dbType === DbType.MongoDB ? "MongoDB" : "Redis"} operations`
      );
      return;
    }

    const generatePreview = async () => {
      const commandsMap = new Map(connectionCommands);
      const allCommands: CrudCommand[] = [];
      commandsMap.forEach((commands) => allCommands.push(...commands));

      if (allCommands.length === 0) {
        setGeneratedSQL("-- No changes to commit");
        return;
      }

      try {
        const executor = await getOperationExecutor(connectionId, dbType);
        const preview = executor.preview(allCommands);

        logger.info("[GlobalChangesDialog] Generated preview:", {
          type: preview.type,
          operationCount: preview.operations.length,
        });

        setGeneratedSQL(preview.content);
      } catch (error) {
        logger.error("[GlobalChangesDialog] Failed to generate preview:", error);
        setGeneratedSQL("-- Error generating preview");
      }
    };
    generatePreview();
  }, [connectionCommands, connectionId, dbType]);

  // Debug: Log when dialog state changes (not on every render)
  useEffect(() => {
    if (open) {
      logger.debug("[GlobalChangesDialog] Dialog opened with state:", {
        connectionId,
        database,
        schema,
        table,
        isTableSpecific,
        connectionCommandsLength: connectionCommands.length,
        groupedByRowLength: groupedByRow.length,
        totalChanges,
        viewMode,
      });
    }
  }, [open, connectionId, database, schema, table, isTableSpecific, connectionCommands.length, groupedByRow.length, totalChanges, viewMode]);

  // Copy SQL to clipboard
  const handleCopySQL = useCallback(async () => {
    try {
      await writeClipboardText(generatedSQL);
      setCopiedSql(true);
      toast.success("SQL copied to clipboard");
      setTimeout(() => {
        setCopiedSql(false);
      }, 2000);
    } catch {
      toast.error("Failed to copy SQL");
    }
  }, [generatedSQL]);

  const handleCommitAll = async () => {
    setIsCommittingLocal(true);
    try {
      if (isTableSpecific) {
        // Table-specific commit
        const tableKey = getTableKey({
          connectionId,
          database: database,
          schema,
          table: table,
        });
        const result = await commitChanges(tableKey);

        logger.info(
          `[GlobalChangesDialog] Commit succeeded, waiting 100ms before invalidating...`,
        );

        // Small delay to ensure database transaction is fully committed
        // before triggering refetch in other components
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Check if we have schema-altering operations (create, drop, duplicate, truncate)
        const tableCommands = stagedCommands.get(tableKey) ?? [];
        const hasSchemaChanges = tableCommands.some(cmd => 
          cmd.type === 'table.create' || 
          cmd.type === 'table.drop' || 
          cmd.type === 'table.duplicate' ||
          cmd.type === 'table.truncate' ||
          cmd.type === 'view.create' ||
          cmd.type === 'view.drop' ||
          cmd.type === 'sequence.create' ||
          cmd.type === 'sequence.drop'
        );

        // Broadcast invalidation to all components displaying this table
        const { invalidateTable, invalidateSchema } = useDataInvalidationStore.getState();
        
        if (hasSchemaChanges) {
          // For schema-altering operations, refresh the entire schema to show new/removed tables
          invalidateSchema(connectionId, database, schema);
          logger.info(
            `[GlobalChangesDialog] Invalidated schema after DDL commit: ${database}.${schema ?? "public"}`,
          );
        } else {
          // For data-only changes, just invalidate the specific table
          invalidateTable(connectionId, database, schema, table);
          logger.info(
            `[GlobalChangesDialog] Invalidated table after commit: ${database}.${
              schema ?? "public"
            }.${table}`,
          );
        }

        // Clear committed changes from store now that commit succeeded
        clearCommittedChanges(tableKey);

        toast.success("Changes committed", {
          description: `Successfully committed ${
            result.committed.length
          } change${result.committed.length === 1 ? "" : "s"} in ${
            result.durationMs
          }ms`,
        });
      } else {
        // Workspace-wide commit
        const results = await commitAll();
        const totalCommitted = Object.values(results).reduce(
          (sum, result) => sum + result.committed.length,
          0,
        );

        // Check if any commands are schema-altering
        const allCommands: CrudCommand<CrudCommandPayload>[] = [];
        connectionCommands.forEach(([tableKey]) => {
          const commands = stagedCommands.get(tableKey) ?? [];
          allCommands.push(...commands);
        });
        
        const hasSchemaChanges = allCommands.some(cmd => 
          cmd.type === 'table.create' || 
          cmd.type === 'table.drop' || 
          cmd.type === 'table.duplicate' ||
          cmd.type === 'table.truncate' ||
          cmd.type === 'view.create' ||
          cmd.type === 'view.drop' ||
          cmd.type === 'sequence.create' ||
          cmd.type === 'sequence.drop'
        );

        // Broadcast invalidation for all affected tables/schemas
        const { invalidateTable, invalidateSchema } = useDataInvalidationStore.getState();
        
        if (hasSchemaChanges) {
          // Group by schema and invalidate each schema once
          const schemas = new Set<string>();
          connectionCommands.forEach(([tableKey]) => {
            const parts = tableKey.split(":");
            const [connId, db, sch] = parts;
            if (connId && db && sch) {
              schemas.add(`${connId}:${db}:${sch}`);
            }
          });
          
          schemas.forEach((schemaKey) => {
            const [connId, db, sch] = schemaKey.split(":");
            if (connId && db && sch) {
              invalidateSchema(connId, db, sch);
              logger.info(
                `[GlobalChangesDialog] Invalidated schema after DDL commit: ${db}.${sch}`,
              );
            }
          });
        } else {
          // For data-only changes, invalidate each table
          connectionCommands.forEach(([tableKey]) => {
            const parts = tableKey.split(":");
            const [connId, db, sch, tbl] = parts;
            if (connId && db && tbl) {
              invalidateTable(connId, db, sch, tbl);
              logger.info(
                `[GlobalChangesDialog] Invalidated table after commit: ${db}.${
                  sch ?? "public"
                }.${tbl}`,
              );
            }
          });
        }

        // Clear committed changes from store for all tables
        connectionCommands.forEach(([tableKey]) => {
          clearCommittedChanges(tableKey);
        });

        toast.success("All changes committed", {
          description: `Successfully committed ${totalCommitted} change${
            totalCommitted === 1 ? "" : "s"
          } across all tables`,
        });
      }

      onOpenChange(false);

      if (onCommitSuccess) {
        onCommitSuccess();
      }
    } catch (error) {
      logger.error("❌ Commit failed:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";

      // Check for conflict detection error - show inline alert instead of toast
      if (
        errorMessage.includes("modified by another user") ||
        errorMessage.includes("CONFLICT")
      ) {
        setConflictError(errorMessage);
        // Don't close dialog - let user choose Override or Refresh
      } else {
        toast.error("Commit failed", {
          description: errorMessage,
        });
      }
      setIsCommittingLocal(false);
    } finally {
      setIsCommittingLocal(false);
    }
  };

  // Force commit - strips oldValue from UPDATE commands to bypass conflict check
  const handleForceCommit = async () => {
    setIsCommittingLocal(true);
    setConflictError(null);

    try {
      // Get current staged commands and create NEW commands without oldValue
      const tableKey = isTableSpecific
        ? getTableKey({
            connectionId,
            database: database,
            schema,
            table: table,
          })
        : null;

      // Helper to strip oldValue from a command (creates new object)
      const stripOldValue = (cmd: CrudCommand): CrudCommand => {
        if (cmd.type !== "data.update") return cmd;

        const payload = cmd.payload as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { oldValue, ...payloadWithoutOldValue } = payload;

        return {
          ...cmd,
          payload: payloadWithoutOldValue,
        } as CrudCommand;
      };

      // Update staged commands in store with oldValue removed
      const { stageCommands, discardChanges: discardTableChanges } =
        useCrudStore.getState();

      if (isTableSpecific && tableKey) {
        const originalCommands = stagedCommands.get(tableKey) ?? [];
        const strippedCommands = originalCommands.map(stripOldValue);

        // Clear existing commands and re-stage without oldValue
        discardTableChanges(tableKey);
        stageCommands(strippedCommands);

        // Now commit
        const result = await commitChanges(tableKey);

        await new Promise((resolve) => setTimeout(resolve, 100));

        const { invalidateTable } = useDataInvalidationStore.getState();
        invalidateTable(connectionId, database, schema, table);

        // Clear committed changes from store
        const { clearCommittedChanges: clearChanges } = useCrudStore.getState();
        clearChanges(tableKey);

        toast.success("Changes force-committed", {
          description: `Overwrote with your changes (${
            result.committed.length
          } change${result.committed.length === 1 ? "" : "s"})`,
        });
      } else {
        // For workspace-wide, process each table
        for (const [tk, commands] of connectionCommands) {
          const strippedCommands = commands.map(stripOldValue);
          discardTableChanges(tk);
          stageCommands(strippedCommands);
        }

        const results = await commitAll();
        const totalCommitted = Object.values(results).reduce(
          (sum, result) => sum + result.committed.length,
          0,
        );

        const { invalidateTable } = useDataInvalidationStore.getState();
        const { clearCommittedChanges: clearChanges } = useCrudStore.getState();
        connectionCommands.forEach(([tk]) => {
          const parts = tk.split(":");
          const [connId, db, sch, tbl] = parts;
          if (connId && db && tbl) {
            invalidateTable(connId, db, sch, tbl);
          }
          // Clear committed changes for each table
          clearChanges(tk);
        });

        toast.success("All changes force-committed", {
          description: `Overwrote with your changes (${totalCommitted} total)`,
        });
      }

      onOpenChange(false);
      onCommitSuccess?.();
    } catch (error) {
      logger.error("❌ Force commit failed:", error);
      toast.error("Force commit failed", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsCommittingLocal(false);
    }
  };

  // Refresh - discard changes and refresh table data
  const handleRefreshAndDiscard = () => {
    // Discard staged changes
    if (isTableSpecific) {
      const tableKey = getTableKey({
        connectionId,
        database: database,
        schema,
        table: table,
      });
      discardChanges(tableKey);
    } else {
      discardAll();
    }

    // Invalidate to trigger refetch
    const { invalidateTable } = useDataInvalidationStore.getState();
    if (isTableSpecific) {
      invalidateTable(connectionId, database, schema, table);
    } else {
      connectionCommands.forEach(([tk]) => {
        const parts = tk.split(":");
        const [connId, db, sch, tbl] = parts;
        if (connId && db && tbl) {
          invalidateTable(connId, db, sch, tbl);
        }
      });
    }

    setConflictError(null);
    onOpenChange(false);
    toast.success("Changes discarded", {
      description: "Table refreshed with latest data from database",
    });
  };

  const handleDiscardAll = () => {
    if (isTableSpecific) {
      const tableKey = getTableKey({
        connectionId,
        database: database,
        schema,
        table: table,
      });
      discardChanges(tableKey);
      toast.success("Changes discarded");
    } else {
      discardAll();
      toast.success("All changes discarded");
    }
    onOpenChange(false);
  };

  const handleUndoRow = (commands: CrudCommand[]) => {
    commands.forEach((cmd) => {
      unstageCommand(cmd.id);
    });

    const commandCount = commands.length;
    const commandType = commands[0]?.type.split(".")[1] || "change";
    toast.success(`${commandType} change undone`, {
      description: `Removed ${commandCount} ${
        commandCount === 1 ? "field" : "fields"
      }`,
    });
  };

  if (connectionCommands.length === 0) {
    return null;
  }

  const showSidebar = !isTableSpecific && tableSummaries.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-none! w-screen! h-screen! rounded-none! p-0 gap-0 overflow-hidden border-none z-50 bg-secondary"
        showCloseButton={false}
      >
        <div className="flex h-full flex-col">
          {/* Top Bar */}
          <div
            data-tauri-drag-region
            className="h-12 flex items-center gap-3 px-4 pl-20 border-b border-border/50 bg-secondary shrink-0"
          >
            <Button
              variant="ghost"
              className="px-2 gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => onOpenChange(false)}
            >
              <IconChevronLeft className="size-4!" />
              <span className="text-sm">Back</span>
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <span className="text-sm font-medium">
              {isTableSpecific ? "Commit Changes" : "Review All Changes"}
            </span>
            <span className="text-xs text-muted-foreground">
              {totalChanges} {totalChanges === 1 ? "change" : "changes"}
              {!isTableSpecific && tableSummaries.length > 0 && (
                <> across {tableSummaries.length} {tableSummaries.length === 1 ? "table" : "tables"}</>
              )}
            </span>
          </div>

          {/* Main Content Area */}
          <div className="flex flex-1 min-h-0">
            {/* Sidebar - table list (workspace-wide mode with multiple tables) */}
            {showSidebar && (
              <div className="w-56 shrink-0 border-r border-border/50 bg-secondary flex flex-col">
                <div className="p-3 pb-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tables</p>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-2">
                  {/* "All tables" option */}
                  <button
                    className={cn(
                      "w-full text-left px-2.5 py-2 rounded-md text-sm mb-0.5 transition-colors",
                      selectedTableKey === null
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                    )}
                    onClick={() => setSelectedTableKey(null)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">All tables</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{totalChanges}</span>
                    </div>
                  </button>
                  {tableSummaries.map((ts) => (
                    <button
                      key={ts.tableKey}
                      className={cn(
                        "w-full text-left px-2.5 py-2 rounded-md text-sm mb-0.5 transition-colors",
                        selectedTableKey === ts.tableKey
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                      )}
                      onClick={() => setSelectedTableKey(ts.tableKey)}
                    >
                      <div className="flex items-center gap-1.5">
                        <IconTable className="h-3.5 w-3.5 shrink-0 opacity-50" />
                        <span className="truncate font-medium">{ts.displayName}</span>
                      </div>
                      <div className="flex gap-2 mt-1 ml-5 text-xs">
                        {ts.inserts > 0 && <span className="text-green-500">+{ts.inserts}</span>}
                        {ts.updates > 0 && <span className="text-blue-500">~{ts.updates}</span>}
                        {ts.deletes > 0 && <span className="text-red-500">-{ts.deletes}</span>}
                        {ts.ddl > 0 && <span className="text-purple-500">{ts.ddl} DDL</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Content Panel */}
            <div className="flex-1 flex flex-col min-h-0 min-w-0 p-2 pl-0 bg-transparent">
              <div className="flex-1 flex flex-col overflow-hidden bg-background rounded-xl">
                {/* Conflict Alert */}
                {conflictError && (
                  <Alert
                    variant="destructive"
                    className="m-4 mb-0 border-destructive/50 bg-destructive/10"
                  >
                    <IconAlertTriangle className="h-4 w-4" />
                    <AlertTitle className="text-sm font-semibold">
                      Conflict Detected
                    </AlertTitle>
                    <AlertDescription>
                      <p className="mb-3">
                        The row was modified by another user or process since you
                        started editing. You can either override with your changes or
                        refresh to see the latest data.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="destructive"
                          onClick={handleForceCommit}
                          disabled={isCommitting}
                        >
                          {isCommitting ? (
                            <IconLoader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <IconShieldCheck className="mr-1 h-3 w-3" />
                          )}
                          Override with My Changes
                        </Button>
                        <Button
                          variant="outline"
                          onClick={handleRefreshAndDiscard}
                          disabled={isCommitting}
                        >
                          <IconRefresh className="mr-1 h-3 w-3" />
                          Discard & Refresh
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {/* View Mode Tabs */}
                <Tabs
                  value={viewMode}
                  onValueChange={(value) => {
                    setViewMode(value as "changes" | "sql");
                  }}
                  className="flex-1 flex flex-col min-h-0"
                >
                  <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <TabsList>
                      <TabsTrigger value="changes">
                        <IconList className="h-3.5 w-3.5" />
                        Changes
                      </TabsTrigger>
                      <TabsTrigger value="sql">
                        <IconCode className="h-3.5 w-3.5" />
                        SQL
                      </TabsTrigger>
                    </TabsList>

                    {viewMode === "sql" && (
                      <Button variant="outline" size="sm" onClick={handleCopySQL}>
                        {copiedSql ? (
                          <>
                            <IconCheck className="h-3.5 w-3.5 mr-1.5 text-green-500" />
                            Copied
                          </>
                        ) : (
                          <>
                            <IconCopy className="h-3.5 w-3.5 mr-1.5" />
                            Copy SQL
                          </>
                        )}
                      </Button>
                    )}
                  </div>

                  {/* Changes List - Virtualized */}
                  <TabsContent
                    value="changes"
                    className="m-0 flex-1 min-h-0 data-[state=active]:flex data-[state=active]:flex-col"
                  >
                    {filteredGroupedByRow.length === 0 ? (
                      <div className="text-sm text-muted-foreground text-center py-8">
                        No changes to display
                      </div>
                    ) : (
                      <VirtualizedChangesList
                        groupedByRow={filteredGroupedByRow}
                        onUndo={handleUndoRow}
                      />
                    )}
                  </TabsContent>

                  {/* SQL Preview */}
                  <TabsContent
                    value="sql"
                    className="m-0 flex-1 min-h-0 data-[state=active]:flex data-[state=active]:flex-col"
                  >
                    <div className="flex-1 min-h-0 overflow-hidden px-4 pb-4">
                      <CodeEditor
                        value={generatedSQL || "-- No SQL generated"}
                        readOnly={true}
                        language="sql"
                        dialect={dbTypeToDialect[dbType]}
                        lineNumbers={true}
                        height="100%"
                      />
                    </div>
                  </TabsContent>
                </Tabs>

                {/* Validation Error Alert */}
                {!validationStatus.canCommitAll && (
                  <Alert variant="destructive" className="mx-4 mb-2">
                    <IconAlertTriangle className="h-4 w-4" />
                    <AlertTitle>Cannot commit: validation errors</AlertTitle>
                    <AlertDescription>
                      {validationStatus.totalErrors} validation{" "}
                      {validationStatus.totalErrors === 1 ? "error" : "errors"} in{" "}
                      {Object.keys(validationStatus.tableErrors).length}{" "}
                      {Object.keys(validationStatus.tableErrors).length === 1
                        ? "table"
                        : "tables"}
                      :{" "}
                      {Object.entries(validationStatus.tableErrors)
                        .map(([tbl, count]) => `${tbl} (${count})`)
                        .join(", ")}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Footer Actions */}
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/50 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDiscardAll}
                    disabled={isCommitting}
                  >
                    <IconX className="h-3.5 w-3.5 mr-1.5" />
                    {isTableSpecific ? "Discard" : "Discard All"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCommitAll}
                    disabled={isCommitting || !validationStatus.canCommitAll}
                    title={
                      !validationStatus.canCommitAll
                        ? `Fix ${validationStatus.totalErrors} validation error${
                            validationStatus.totalErrors === 1 ? "" : "s"
                          } before committing`
                        : undefined
                    }
                  >
                    {isCommitting ? (
                      <>
                        <IconLoader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        Committing...
                      </>
                    ) : (
                      <>
                        <IconCircleCheckFilled className="h-3.5 w-3.5 mr-1.5" />
                        Commit {totalChanges}{" "}
                        {totalChanges === 1 ? "Change" : "Changes"}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Virtualized Changes List ----------

interface VirtualizedChangesListProps {
  groupedByRow: Array<{
    rowKey: string;
    tableName: string;
    commands: CrudCommand[];
  }>;
  onUndo: (commands: CrudCommand[]) => void;
}

/**
 * Virtualized list of row change cards. Only renders cards in the viewport,
 * preventing the UI from freezing when previewing thousands of changes.
 */
function VirtualizedChangesList({ groupedByRow, onUndo }: VirtualizedChangesListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: groupedByRow.length,
    getScrollElement: () => scrollRef.current,
    // Estimate: header (~36px) + diff content (~60px) + padding/border (~12px)
    estimateSize: () => 108,
    overscan: 5,
  });

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto px-4 pb-4"
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const row = groupedByRow[virtualItem.index];
          if (!row) return null;
          return (
            <div
              key={row.rowKey}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
                paddingBottom: "8px", // gap between cards
              }}
            >
              <MemoizedRowChangesCard
                row={row}
                index={virtualItem.index}
                onUndo={onUndo}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Row Changes Card ----------

interface RowChangesCardProps {
  row: {
    rowKey: string;
    tableName: string;
    commands: CrudCommand[];
  };
  index: number;
  onUndo: (commands: CrudCommand[]) => void;
}

function RowChangesCardInner({ row, index, onUndo }: RowChangesCardProps) {
  const { resolvedTheme } = useTheme();

  // Determine the operation type (insert, update, delete, DDL)
  const hasInsert = row.commands.some((cmd) => cmd.type === "data.insert");
  const hasDelete = row.commands.some((cmd) => cmd.type === "data.delete");
  const hasUpdate = row.commands.some((cmd) => cmd.type === "data.update");
  const hasDDL = row.commands.some(
    (cmd) =>
      cmd.type.startsWith("column.") ||
      cmd.type.startsWith("index.") ||
      cmd.type.startsWith("trigger.") ||
      cmd.type.startsWith("fk.") ||
      cmd.type.startsWith("table.") ||
      cmd.type.startsWith("view.") ||
      cmd.type.startsWith("constraint.") ||
      cmd.type.startsWith("sequence."),
  );

  // Get primary key info
  let pkInfo = "";
  if (hasUpdate || hasDelete) {
    const cmd = row.commands.find(
      (c) => c.type === "data.update" || c.type === "data.delete",
    );
    if (cmd) {
      const payload = cmd.payload as { primaryKeys?: Record<string, unknown> };
      if (payload.primaryKeys) {
        pkInfo = Object.entries(payload.primaryKeys)
          .map(([key, value]) => `${key}=${formatValue(value)}`)
          .join(", ");
      }
    }
  }

  // Build old and new row representations for diff
  // Memoize diff computation — expensive for large payloads and many cards
  const buildRowDiff = useCallback(() => {
    if (hasDDL) {
      // Handle DDL commands
      const ddlLines: string[] = [];
      row.commands.forEach((cmd) => {
        const desc = cmd.metadata.description ?? cmd.type;
        ddlLines.push(desc);

        // Show payload details
        const payload = cmd.payload as Record<string, unknown>;
        logger.info("[GlobalChangesDialog] DDL command:", {
          type: cmd.type,
          payload,
        });
        if (cmd.type === "table.create") {
          // table.create - show table definition
          if (payload.tableName) {
            ddlLines.push(`  Table: ${payload.tableName}`);
          }
          if (Array.isArray(payload.columns)) {
            ddlLines.push(`  Columns:`);
            payload.columns.forEach((col: { name?: string; dataType?: string; nullable?: boolean; defaultValue?: unknown; isPrimaryKey?: boolean; checkExpression?: string; comment?: string }) => {
              let colDef = `    - ${col.name}: ${col.dataType}`;
              if (col.nullable === false) colDef += " NOT NULL";
              if (col.defaultValue !== undefined && col.defaultValue !== null) colDef += ` DEFAULT ${col.defaultValue}`;
              if (col.isPrimaryKey) colDef += " (PK)";
              if (col.checkExpression) colDef += ` CHECK (${col.checkExpression})`;
              if (col.comment) colDef += ` -- ${col.comment}`;
              ddlLines.push(colDef);
            });
          }
          if (Array.isArray(payload.primaryKey) && payload.primaryKey.length > 0) {
            ddlLines.push(`  Primary Key: (${(payload.primaryKey as string[]).join(", ")})`);
          }
        } else if (cmd.type === "table.rename") {
          // table.rename - show old → new
          const oldName = cmd.target.table;
          if (oldName && payload.newName) {
            ddlLines.push(`  ${oldName} → ${payload.newName}`);
          }
        } else if (cmd.type === "table.drop") {
          // table.drop - show table name
          if (payload.tableName) {
            ddlLines.push(`  Table: ${payload.tableName}`);
          }
          if (payload.cascade) {
            ddlLines.push(`  Cascade: true`);
          }
        } else if (cmd.type === "table.truncate") {
          // table.truncate - show table name and options
          if (payload.tableName) {
            ddlLines.push(`  Table: ${payload.tableName}`);
          }
          if (payload.restartIdentity) {
            ddlLines.push(`  Restart Identity: true`);
          }
          if (payload.cascade) {
            ddlLines.push(`  Cascade: true`);
          }
        } else if (cmd.type === "table.duplicate") {
          // table.duplicate - show source → target and options
          if (payload.sourceTableName && payload.newTableName) {
            ddlLines.push(`  ${payload.sourceTableName} → ${payload.newTableName}`);
          }
          const options: string[] = [];
          if (payload.includeData) options.push("data");
          if (payload.includeIndexes) options.push("indexes");
          if (payload.includeConstraints) options.push("constraints");
          if (payload.includeTriggers) options.push("triggers");
          if (options.length > 0) {
            ddlLines.push(`  Include: ${options.join(", ")}`);
          }
        } else if (cmd.type === "view.create") {
          // view.create - show view definition
          if (payload.definition) {
            const viewDef = payload.definition as { name?: string; definition?: string; isMaterialized?: boolean };
            if (viewDef.name) {
              ddlLines.push(`  View: ${viewDef.name}${viewDef.isMaterialized ? " (MATERIALIZED)" : ""}`);
            }
            if (viewDef.definition) {
              const defPreview = viewDef.definition.length > 100 
                ? viewDef.definition.slice(0, 100) + "..." 
                : viewDef.definition;
              ddlLines.push(`  Definition: ${defPreview}`);
            }
          }
        } else if (cmd.type === "view.drop") {
          // view.drop - show view name
          if (payload.viewName) {
            ddlLines.push(`  View: ${payload.viewName}${payload.isMaterialized ? " (MATERIALIZED)" : ""}`);
          }
          if (payload.cascade) {
            ddlLines.push(`  Cascade: true`);
          }
        } else if (cmd.type === "view.replace") {
          // view.replace - show view name and new definition
          if (payload.viewName) {
            ddlLines.push(`  View: ${payload.viewName}${payload.isMaterialized ? " (MATERIALIZED)" : ""}`);
          }
          if (payload.definition) {
            const defPreview = (payload.definition as string).length > 100 
              ? (payload.definition as string).slice(0, 100) + "..." 
              : payload.definition;
            ddlLines.push(`  New Definition: ${defPreview}`);
          }
        } else if (cmd.type === "view.rename") {
          // view.rename - show old → new
          if (payload.viewName && payload.newName) {
            ddlLines.push(`  ${payload.viewName} → ${payload.newName}${payload.isMaterialized ? " (MATERIALIZED)" : ""}`);
          }
        } else if (cmd.type.startsWith("constraint.")) {
          // constraint operations
          if (cmd.type === "constraint.addPrimaryKey" || cmd.type === "constraint.addUnique" || cmd.type === "constraint.addCheck") {
            if (payload.definition) {
              const constraintDef = payload.definition as { name?: string; type?: string; columns?: string[]; expression?: string };
              if (constraintDef.name) {
                ddlLines.push(`  Constraint: ${constraintDef.name} (${constraintDef.type?.toUpperCase()})`);
              }
              if (constraintDef.columns && constraintDef.columns.length > 0) {
                ddlLines.push(`  Columns: ${constraintDef.columns.join(", ")}`);
              }
              if (constraintDef.expression) {
                ddlLines.push(`  Expression: ${constraintDef.expression}`);
              }
            }
          } else if (cmd.type === "constraint.rename") {
            if (payload.constraintName && payload.newName) {
              ddlLines.push(`  ${payload.constraintName} → ${payload.newName}`);
            }
          } else {
            // drop operations
            if (payload.constraintName) {
              ddlLines.push(`  Constraint: ${payload.constraintName}`);
            }
            if (payload.cascade) {
              ddlLines.push(`  Cascade: true`);
            }
          }
        } else if (cmd.type === "sequence.create") {
          // sequence.create - show sequence definition
          if (payload.definition) {
            const seqDef = payload.definition as { name?: string; increment?: number; minValue?: number; maxValue?: number; startValue?: number; cycle?: boolean };
            if (seqDef.name) {
              ddlLines.push(`  Sequence: ${seqDef.name}`);
            }
            if (seqDef.increment !== undefined) {
              ddlLines.push(`  Increment: ${seqDef.increment}`);
            }
            if (seqDef.startValue !== undefined) {
              ddlLines.push(`  Start: ${seqDef.startValue}`);
            }
            if (seqDef.minValue !== undefined) {
              ddlLines.push(`  Min: ${seqDef.minValue}`);
            }
            if (seqDef.maxValue !== undefined) {
              ddlLines.push(`  Max: ${seqDef.maxValue}`);
            }
            if (seqDef.cycle) {
              ddlLines.push(`  Cycle: true`);
            }
          }
        } else if (cmd.type === "sequence.alter") {
          // sequence.alter - show changes
          if (payload.sequenceName) {
            ddlLines.push(`  Sequence: ${payload.sequenceName}`);
          }
          if (payload.changes) {
            const changes = payload.changes as Record<string, unknown>;
            Object.entries(changes).forEach(([key, value]) => {
              ddlLines.push(`  ${key}: ${value}`);
            });
          }
        } else if (cmd.type === "sequence.drop") {
          // sequence.drop - show sequence name
          if (payload.sequenceName) {
            ddlLines.push(`  Sequence: ${payload.sequenceName}`);
          }
          if (payload.cascade) {
            ddlLines.push(`  Cascade: true`);
          }
        } else if (cmd.type === "sequence.rename") {
          // sequence.rename - show old → new
          if (payload.sequenceName && payload.newName) {
            ddlLines.push(`  ${payload.sequenceName} → ${payload.newName}`);
          }
        } else if (payload.column) {
          // column.add - show full column definition
          ddlLines.push(`  Column: ${JSON.stringify(payload.column, null, 2)}`);
        } else if (payload.definition) {
          // index/trigger - show definition
          ddlLines.push(
            `  Definition: ${JSON.stringify(payload.definition, null, 2)}`,
          );
        } else if (payload.columnName && payload.newDefinition) {
          // column.modify - show what changed
          const name = payload.columnName;
          ddlLines.push(`  Column: ${name}`);
          const newDef = payload.newDefinition as {
            dataType?: string;
            nullable?: boolean;
            defaultValue?: string | null;
            comment?: string;
          };
          if (newDef.dataType !== undefined) {
            ddlLines.push(`  Type: ${newDef.dataType}`);
          }
          if (newDef.nullable !== undefined) {
            ddlLines.push(`  Nullable: ${newDef.nullable ? "YES" : "NO"}`);
          }
          if (newDef.defaultValue !== undefined) {
            ddlLines.push(`  Default: ${newDef.defaultValue ?? "NULL"}`);
          }
          if (newDef.comment !== undefined) {
            ddlLines.push(`  Comment: ${newDef.comment}`);
          }
        } else if (payload.newName && payload.columnName) {
          // column.rename - show old → new
          ddlLines.push(`  ${payload.columnName} → ${payload.newName}`);
        } else if (
          payload.columnName ||
          payload.indexName ||
          payload.triggerName ||
          payload.constraintName
        ) {
          // Other DDL operations (drop, etc.)
          const name =
            payload.columnName || payload.indexName || payload.triggerName || payload.constraintName;
          ddlLines.push(`  Name: ${name}`);
          if (payload.cascade) {
            ddlLines.push(`  Cascade: true`);
          }
        }
      });

      return { old: "", new: ddlLines.join("\n") };
    }

    if (hasInsert) {
      const insertCmd = row.commands.find((cmd) => cmd.type === "data.insert");
      if (!insertCmd) return { old: "", new: "" };

      const payload = insertCmd.payload as {
        values?: Record<string, unknown>;
      };
      const values = payload.values || {};

      const entries = Object.entries(values);
      if (entries.length === 0) {
        return { old: "", new: "(new empty document)" };
      }

      const newRow = entries
        .map(([key, value]) => {
          const formatted = formatValue(value);
          // For long INSERT values, truncate in the middle
          return `${key}: ${
            formatted.length > 100 ? truncateMiddle(formatted, 100) : formatted
          }`;
        })
        .join("\n");

      return { old: "", new: newRow };
    }

    if (hasDelete) {
      const deleteCmd = row.commands.find((cmd) => cmd.type === "data.delete");
      if (!deleteCmd) return { old: "", new: "" };

      const payload = deleteCmd.payload as {
        primaryKeys?: Record<string, unknown>;
      };
      const pks = payload.primaryKeys || {};

      const oldRow = Object.entries(pks)
        .map(([key, value]) => {
          const formatted = formatValue(value);
          // For long DELETE values, truncate in the middle
          return `${key}: ${
            formatted.length > 100 ? truncateMiddle(formatted, 100) : formatted
          }`;
        })
        .join("\n");

      return { old: oldRow, new: "" };
    }

    if (hasUpdate) {
      const updateCmds = row.commands.filter(
        (cmd) => cmd.type === "data.update",
      );

      // Build a map of column -> [oldValue, newValue]
      const changes = new Map<string, { old: unknown; new: unknown }>();

      updateCmds.forEach((cmd) => {
        const payload = cmd.payload as {
          column?: string;
          oldValue: unknown;
          newValue: unknown;
        };
        if (payload.column) {
          changes.set(payload.column, {
            old: payload.oldValue,
            new: payload.newValue,
          });
        }
      });

      const oldRow: string[] = [];
      const newRow: string[] = [];

      changes.forEach((values, column) => {
        // Use smart truncation for long values
        const { old, new: newVal } = formatValueWithSmartTruncation(
          values.old,
          values.new,
        );
        oldRow.push(`${column}: ${old}`);
        newRow.push(`${column}: ${newVal}`);
      });

      return { old: oldRow.join("\n"), new: newRow.join("\n") };
    }

    return { old: "", new: "" };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are the command list identity
  }, [row.commands]);

  const { old, new: newVal } = useMemo(() => buildRowDiff(), [buildRowDiff]);

  // Debug: log when diff is empty
  if (!old && !newVal) {
    logger.warn("[RowChangesCard] Empty diff for row:", {
      rowKey: row.rowKey,
      tableName: row.tableName,
      commandCount: row.commands.length,
      commandTypes: row.commands.map((c) => c.type),
    });
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
        <span className="text-xs text-muted-foreground font-mono">
          #{index + 1}
        </span>
        <span className="text-xs text-muted-foreground">{row.tableName}</span>
        {hasInsert && (
          <>
            <IconPlus className="h-3.5 w-3.5 text-green-500 ml-2" />
            <span className="text-xs font-medium text-green-600 dark:text-green-400">
              Insert
            </span>
          </>
        )}
        {hasDelete && (
          <>
            <IconTrash className="h-3.5 w-3.5 text-red-500 ml-2 select-text" />
            <span className="text-xs font-medium text-red-600 dark:text-red-400">
              Delete
            </span>
            {pkInfo && (
              <span className="text-xs text-muted-foreground ml-1">
                {pkInfo}
              </span>
            )}
          </>
        )}
        {hasUpdate && (
          <>
            <IconPencil className="h-3.5 w-3.5 text-blue-500 ml-2" />
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              Update
            </span>
            {pkInfo && (
              <span className="text-xs text-muted-foreground ml-1">
                {pkInfo}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              ({row.commands.length}{" "}
              {row.commands.length === 1 ? "field" : "fields"})
            </span>
          </>
        )}
        {hasDDL && (
          <>
            <IconPencil className="h-3.5 w-3.5 text-purple-500 ml-2" />
            <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
              DDL
            </span>
            <span className="text-xs text-muted-foreground">
              ({row.commands.length}{" "}
              {row.commands.length === 1 ? "change" : "changes"})
            </span>
          </>
        )}

        {/* Undo Button */}
        <Button
          variant="ghost"
          className="ml-auto h-6 px-2 text-xs hover:bg-destructive/10 hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onUndo(row.commands);
          }}
        >
          <IconArrowBackUp className="h-3 w-3 mr-1" />
          Undo
        </Button>
      </div>

      {/* Diff Viewer */}
      <div className="text-xs [&_.diff-viewer]:!text-xs [&_.diff-viewer]:!font-mono">
        {!old && !newVal ? (
          <div className="p-3 text-muted-foreground italic">
            Unable to display diff for {row.commands.length} command(s):
            {row.commands.map((c, i) => (
              <span key={i} className="ml-2 text-xs font-mono">
                {c.type}
              </span>
            ))}
          </div>
        ) : (
          <ReactDiffViewer
            oldValue={old}
            newValue={newVal}
            splitView={true}
            hideLineNumbers={true}
            showDiffOnly={false}
            compareMethod={DiffMethod.WORDS}
            useDarkTheme={resolvedTheme === "dark"}
            styles={{
              variables: {
                // Light theme - matches CodeEditor light theme from themes.ts
                light: {
                  diffViewerBackground: "#FAF8F5",  // CodeEditor light background
                  addedBackground: "#16A34A1A",     // Green with transparency
                  addedColor: "#27231E",            // CodeEditor light foreground
                  removedBackground: "#DC26261A",   // Red with transparency
                  removedColor: "#27231E",          // CodeEditor light foreground
                  wordAddedBackground: "#16A34A33", // Green word highlight
                  wordRemovedBackground: "#DC262633", // Red word highlight
                  addedGutterBackground: "#16A34A14",
                  removedGutterBackground: "#DC262614",
                  gutterBackground: "#FAF8F5",      // CodeEditor light gutterBackground
                  gutterBackgroundDark: "#F5F3F0",
                  highlightBackground: "#D4A52B1A", // Brand golden with transparency
                  highlightGutterBackground: "#D4A52B14",
                  emptyLineBackground: "#FAF8F5",
                  codeFoldBackground: "#F5F3F0",
                  codeFoldGutterBackground: "#F5F3F0",
                },
                // Dark theme - matches CodeEditor dark theme from themes.ts
                dark: {
                  diffViewerBackground: "#110F0C",  // CodeEditor dark background
                  addedBackground: "#22C55E1A",     // Green with transparency
                  addedColor: "#EBE7E2",            // CodeEditor dark foreground
                  removedBackground: "#EF44441A",   // Red with transparency
                  removedColor: "#EBE7E2",          // CodeEditor dark foreground
                  wordAddedBackground: "#22C55E33", // Green word highlight
                  wordRemovedBackground: "#EF444433", // Red word highlight
                  addedGutterBackground: "#22C55E14",
                  removedGutterBackground: "#EF444414",
                  gutterBackground: "#110F0C",      // CodeEditor dark gutterBackground
                  gutterBackgroundDark: "#0D0B09",
                  highlightBackground: "#D4A52B1A", // Brand golden with transparency
                  highlightGutterBackground: "#D4A52B14",
                  emptyLineBackground: "#110F0C",
                  codeFoldBackground: "#1A1714",
                  codeFoldGutterBackground: "#1A1714",
                },
              },
            }}
          />
        )}
      </div>
    </div>
  );
}

const MemoizedRowChangesCard = memo(RowChangesCardInner, (prev, next) => {
  // Re-render only when row identity or commands change
  return (
    prev.row.rowKey === next.row.rowKey &&
    prev.row.commands === next.row.commands &&
    prev.index === next.index &&
    prev.onUndo === next.onUndo
  );
});

/**
 * Format a value for display in the diff viewer.
 * For short values, show the full value.
 * For long values, show the full value (truncation happens at the diff level).
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "string") {
    return value; // No quotes for cleaner display
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

/**
 * Smart truncation for long unchanged portions of text.
 * Shows context around changes like GitHub's diff view.
 */
function formatValueWithSmartTruncation(
  oldValue: unknown,
  newValue: unknown,
): { old: string; new: string } {
  const oldStr = formatValue(oldValue);
  const newStr = formatValue(newValue);

  // For short values, return as-is
  const MAX_LENGTH = 100;
  if (oldStr.length <= MAX_LENGTH && newStr.length <= MAX_LENGTH) {
    return { old: oldStr, new: newStr };
  }

  // For very different values (insert/delete), show with ellipsis
  if (oldStr === "NULL" || newStr === "NULL") {
    return {
      old:
        oldStr.length > MAX_LENGTH
          ? truncateMiddle(oldStr, MAX_LENGTH)
          : oldStr,
      new:
        newStr.length > MAX_LENGTH
          ? truncateMiddle(newStr, MAX_LENGTH)
          : newStr,
    };
  }

  // Find common prefix and suffix
  const { prefix, suffix, oldMiddle, newMiddle } = findDiff(oldStr, newStr);

  const CONTEXT_LENGTH = 30;
  const prefixContext =
    prefix.length > CONTEXT_LENGTH
      ? "..." + prefix.slice(-CONTEXT_LENGTH)
      : prefix;
  const suffixContext =
    suffix.length > CONTEXT_LENGTH
      ? suffix.slice(0, CONTEXT_LENGTH) + "..."
      : suffix;

  // If the middle parts are still too long, truncate them
  const oldMiddleTruncated =
    oldMiddle.length > MAX_LENGTH
      ? truncateMiddle(oldMiddle, MAX_LENGTH)
      : oldMiddle;
  const newMiddleTruncated =
    newMiddle.length > MAX_LENGTH
      ? truncateMiddle(newMiddle, MAX_LENGTH)
      : newMiddle;

  return {
    old: prefixContext + oldMiddleTruncated + suffixContext,
    new: prefixContext + newMiddleTruncated + suffixContext,
  };
}

/**
 * Find the common prefix, suffix, and differing middle parts of two strings.
 */
function findDiff(
  str1: string,
  str2: string,
): {
  prefix: string;
  suffix: string;
  oldMiddle: string;
  newMiddle: string;
} {
  let prefixEnd = 0;
  const minLen = Math.min(str1.length, str2.length);

  // Find common prefix
  while (prefixEnd < minLen && str1[prefixEnd] === str2[prefixEnd]) {
    prefixEnd++;
  }

  // Find common suffix
  let suffixStart1 = str1.length;
  let suffixStart2 = str2.length;
  while (
    suffixStart1 > prefixEnd &&
    suffixStart2 > prefixEnd &&
    str1[suffixStart1 - 1] === str2[suffixStart2 - 1]
  ) {
    suffixStart1--;
    suffixStart2--;
  }

  return {
    prefix: str1.slice(0, prefixEnd),
    suffix: str1.slice(suffixStart1),
    oldMiddle: str1.slice(prefixEnd, suffixStart1),
    newMiddle: str2.slice(prefixEnd, suffixStart2),
  };
}

/**
 * Truncate a string in the middle, keeping start and end.
 */
function truncateMiddle(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  const halfLength = Math.floor(maxLength / 2) - 3;
  return str.slice(0, halfLength) + " ... " + str.slice(-halfLength);
}
