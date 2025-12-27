import { logger } from "@/lib/logger";
import { useState, useMemo, useCallback, useEffect } from "react";
import { useCrudStore } from "@/stores/crudStore";
import { useConnectionStore } from "@/stores/connectionStoreNew";
import type { CrudCommand } from "@/types/crud";
import { DbType } from "@/types/connection";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
import { useValidationStore } from "@/stores/validationStore";
import { generateSqlPreview } from "@/adapters";
import { CodeEditor, type SqlDialect } from "@/components/CodeEditor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
} from "@tabler/icons-react";
import { toast } from "sonner";
import ReactDiffViewer from "react-diff-viewer-continued";
import { useTheme } from "next-themes";

// Map DbType to SqlDialect for CodeEditor
const dbTypeToDialect: Record<DbType, SqlDialect> = {
  [DbType.PostgreSQL]: "postgresql",
  [DbType.MySQL]: "mysql",
  [DbType.SQLite]: "sqlite",
  [DbType.SQLServer]: "mssql",
};

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
  const {
    stagedCommands,
    commitAll,
    discardAll,
    getTableKey,
    commitChanges,
    discardChanges,
    unstageCommand,
  } = useCrudStore();

  const [isCommitting, setIsCommitting] = useState(false);
  const [viewMode, setViewMode] = useState<"changes" | "sql">("changes");
  const [copiedSql, setCopiedSql] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

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
  const connectionCommands = useMemo(() => {
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
    stagedCommands,
    isTableSpecific,
    connectionId,
    database,
    schema,
    table,
    getTableKey,
  ]);

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

  // Calculate total summary
  const totalSummary = {
    updates: 0,
    inserts: 0,
    deletes: 0,
    ddl: 0,
    total: 0,
  };

  connectionCommands.forEach(([, commands]) => {
    totalSummary.updates += commands.filter(
      (c) => c.type === "data.update",
    ).length;
    totalSummary.inserts += commands.filter(
      (c) => c.type === "data.insert",
    ).length;
    totalSummary.deletes += commands.filter(
      (c) => c.type === "data.delete",
    ).length;
    totalSummary.ddl += commands.filter(
      (c) =>
        c.type.startsWith("column.") ||
        c.type.startsWith("index.") ||
        c.type.startsWith("trigger."),
    ).length;
    totalSummary.total += commands.length;
  });

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
    const generateSQL = async () => {
      const commandsMap = new Map(connectionCommands);
      try {
        const sql = await generateSqlPreview(connectionId, dbType, commandsMap);
        logger.info("[GlobalChangesDialog] Generated SQL:", {
          connectionCommandsCount: connectionCommands.length,
          dbType,
          sqlLength: sql.length,
          sqlPreview: sql.slice(0, 200),
        });
        setGeneratedSQL(sql);
      } catch (error) {
        logger.error("[GlobalChangesDialog] Failed to generate SQL:", error);
        setGeneratedSQL("-- Error generating SQL preview");
      }
    };
    generateSQL();
  }, [connectionCommands, connectionId, dbType]);

  // Debug: Log grouped data
  logger.info("[GlobalChangesDialog] Render state:", {
    connectionId,
    database,
    schema,
    table,
    isTableSpecific,
    connectionCommandsLength: connectionCommands.length,
    groupedByRowLength: groupedByRow.length,
    totalSummary,
    viewMode,
  });

  // Copy SQL to clipboard
  const handleCopySQL = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(generatedSQL);
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
    setIsCommitting(true);
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

        // Broadcast invalidation to all components displaying this table
        const { invalidateTable } = useDataInvalidationStore.getState();
        invalidateTable(connectionId, database, schema, table);
        logger.info(
          `[GlobalChangesDialog] Invalidated table after commit: ${database}.${
            schema ?? "public"
          }.${table}`,
        );

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

        // Broadcast invalidation for all affected tables
        const { invalidateTable } = useDataInvalidationStore.getState();
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
      setIsCommitting(false);
    } finally {
      setIsCommitting(false);
    }
  };

  // Force commit - strips oldValue from UPDATE commands to bypass conflict check
  const handleForceCommit = async () => {
    setIsCommitting(true);
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
        connectionCommands.forEach(([tk]) => {
          const parts = tk.split(":");
          const [connId, db, sch, tbl] = parts;
          if (connId && db && tbl) {
            invalidateTable(connId, db, sch, tbl);
          }
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
      setIsCommitting(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[80vw] max-h-[80vh] flex flex-col p-4">
        <DialogHeader>
          <DialogTitle className="text-xs">
            {isTableSpecific ? "Commit changes" : "Review All Changes"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isTableSpecific
              ? "Review the changes that will be committed to the database."
              : "Review and commit all pending changes across all tables"}
          </DialogDescription>
        </DialogHeader>

        {/* Conflict Alert */}
        {conflictError && (
          <Alert
            variant="destructive"
            className="border-destructive/50 bg-destructive/10"
          >
            <IconAlertTriangle className="h-4 w-4" />
            <AlertTitle className="text-sm font-semibold">
              Conflict Detected
            </AlertTitle>
            <AlertDescription className="text-xs">
              <p className="mb-3">
                The row was modified by another user or process since you
                started editing. You can either override with your changes or
                refresh to see the latest data.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleForceCommit}
                  disabled={isCommitting}
                  className="h-7 text-xs"
                >
                  {isCommitting ? (
                    <IconLoader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <IconShieldCheck className="mr-1 h-3 w-3" />
                  )}
                  Override with My Changes
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRefreshAndDiscard}
                  disabled={isCommitting}
                  className="h-7 text-xs"
                >
                  <IconRefresh className="mr-1 h-3 w-3" />
                  Discard & Refresh
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Debug info */}
        {process.env.NODE_ENV === "development" && (
          <div className="text-[10px] text-muted-foreground bg-muted/30 p-2 rounded font-mono">
            Tables: {connectionCommands.length} | Rows: {groupedByRow.length} |
            Total: {totalSummary.total} | SQL: {generatedSQL.length} chars
          </div>
        )}

        {/* Summary Statistics */}
        <div className="grid grid-cols-5 gap-3">
          <div className="flex items-center gap-2 rounded-xl border bg-card p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <IconCircleCheckFilled className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-semibold">{totalSummary.total}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border bg-card p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10">
              <IconPencil className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Updates</p>
              <p className="text-lg font-semibold">{totalSummary.updates}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border bg-card p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10">
              <IconPlus className="h-4 w-4 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Inserts</p>
              <p className="text-lg font-semibold">{totalSummary.inserts}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border bg-card p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10">
              <IconTrash className="h-4 w-4 text-red-500 select-text" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Deletes</p>
              <p className="text-lg font-semibold">{totalSummary.deletes}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border bg-card p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/10">
              <IconPencil className="h-4 w-4 text-purple-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">DDL</p>
              <p className="text-lg font-semibold">{totalSummary.ddl}</p>
            </div>
          </div>
        </div>

        {/* View Mode Tabs */}
        <Tabs
          value={viewMode}
          onValueChange={(value) => setViewMode(value as "changes" | "sql")}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="flex items-center justify-between">
            <TabsList size="sm">
              <TabsTrigger value="changes" size="sm">
                <IconList className="h-3.5 w-3.5" />
                Changes
              </TabsTrigger>
              <TabsTrigger value="sql" size="sm">
                <IconCode className="h-3.5 w-3.5" />
                SQL
              </TabsTrigger>
            </TabsList>

            {viewMode === "sql" && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleCopySQL}
              >
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

          {/* Changes List - Grouped by Row ID */}
          <TabsContent value="changes" className="flex-1 min-h-0 mt-0">
            <ScrollArea className="h-full min-h-[200px] max-h-[50vh]">
              <div className="space-y-2 px-1">
                {groupedByRow.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    No changes to display
                  </div>
                ) : (
                  groupedByRow.map((row, index) => (
                    <RowChangesCard
                      key={row.rowKey}
                      row={row}
                      index={index}
                      onUndo={handleUndoRow}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* SQL Preview */}
          <TabsContent value="sql" className="flex-1 min-h-0 mt-0">
            <div className="h-full min-h-[200px] max-h-[50vh] rounded-lg border overflow-hidden">
              <CodeEditor
                value={generatedSQL || "-- No SQL generated"}
                readOnly={true}
                language="sql"
                dialect={dbTypeToDialect[dbType]}
                lineNumbers={true}
                height="100%"
                minHeight="200px"
                maxHeight="50vh"
              />
            </div>
          </TabsContent>
        </Tabs>

        <Separator />

        {/* Validation Error Alert */}
        {!validationStatus.canCommitAll && (
          <Alert variant="destructive">
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
                .map(([table, count]) => `${table} (${count})`)
                .join(", ")}
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter className="flex justify-end gap-2">
          {!isTableSpecific && (
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
              disabled={isCommitting}
            >
              Cancel
            </Button>
          )}
          <Button
            variant={isTableSpecific ? "destructive" : "outline"}
            onClick={handleDiscardAll}
            disabled={isCommitting}
          >
            <IconX className="h-3.5 w-3.5 mr-1.5" />
            {isTableSpecific ? "Discard" : "Discard All"}
          </Button>
          <Button
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
                Commit {totalSummary.total}{" "}
                {totalSummary.total === 1 ? "Change" : "Changes"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface RowChangesCardProps {
  row: {
    rowKey: string;
    tableName: string;
    commands: CrudCommand[];
  };
  index: number;
  onUndo: (commands: CrudCommand[]) => void;
}

function RowChangesCard({ row, index, onUndo }: RowChangesCardProps) {
  const { resolvedTheme } = useTheme();

  // Determine the operation type (insert, update, delete, DDL)
  const hasInsert = row.commands.some((cmd) => cmd.type === "data.insert");
  const hasDelete = row.commands.some((cmd) => cmd.type === "data.delete");
  const hasUpdate = row.commands.some((cmd) => cmd.type === "data.update");
  const hasDDL = row.commands.some(
    (cmd) =>
      cmd.type.startsWith("column.") ||
      cmd.type.startsWith("index.") ||
      cmd.type.startsWith("trigger."),
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
  const buildRowDiff = () => {
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
        if (payload.column) {
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
          payload.triggerName
        ) {
          // Other DDL operations (drop, etc.)
          const name =
            payload.columnName || payload.indexName || payload.triggerName;
          ddlLines.push(`  Name: ${name}`);
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

      const newRow = Object.entries(values)
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
  };

  const { old, new: newVal } = buildRowDiff();

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
            useDarkTheme={resolvedTheme === "dark"}
            styles={{
              variables: {
                light: {
                  diffViewerBackground: "#fafafa",
                  addedBackground: "#e6ffec",
                  addedColor: "#24292e",
                  removedBackground: "#ffeef0",
                  removedColor: "#24292e",
                  wordAddedBackground: "#acf2bd",
                  wordRemovedBackground: "#fdb8c0",
                  addedGutterBackground: "#cdffd8",
                  removedGutterBackground: "#ffdce0",
                  gutterBackground: "#f5f5f5",
                  gutterBackgroundDark: "#eeeeee",
                  highlightBackground: "#fffbdd",
                  highlightGutterBackground: "#fff5b1",
                },
                dark: {
                  diffViewerBackground: "#1e1e1e",
                  addedBackground: "#044B53",
                  addedColor: "#e6ffec",
                  removedBackground: "#5A1E1E",
                  removedColor: "#ffeef0",
                  wordAddedBackground: "#055d67",
                  wordRemovedBackground: "#7d2727",
                  addedGutterBackground: "#033e47",
                  removedGutterBackground: "#4b1818",
                  gutterBackground: "#2d2d2d",
                  gutterBackgroundDark: "#262626",
                  highlightBackground: "#3d3d00",
                  highlightGutterBackground: "#4d4d00",
                },
              },
            }}
          />
        )}
      </div>
    </div>
  );
}

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
