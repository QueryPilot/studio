import { logger } from "@/lib/logger";
import { useState, useMemo } from "react";
import { useCrudStore } from "@/stores/crudStore";
import type { CrudCommand } from "@/types/crud";
import { useDataInvalidationStore } from "@/stores/dataInvalidationStore";
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
import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconCircleCheckFilled,
  IconX,
  IconLoader2,
  IconArrowBackUp,
} from "@tabler/icons-react";
import { toast } from "sonner";
import ReactDiffViewer from "react-diff-viewer-continued";
import { useTheme } from "next-themes";

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

  // IconCheck if this is table-specific or workspace-wide
  const isTableSpecific = database !== undefined && table !== undefined;

  // IconFilter commands based on scope
  const connectionCommands = Array.from(stagedCommands.entries()).filter(
    ([tableKey]) => {
      if (isTableSpecific) {
        const specificTableKey = getTableKey({
          connectionId,
          database: database,
          schema,
          table: table,
        });
        return tableKey === specificTableKey;
      }
      return tableKey.startsWith(`${connectionId}:`);
    },
  );

  // Group commands by row ID only, preserving user edit order
  const groupedByRow = useMemo(() => {
    const result: Array<{
      rowKey: string;
      tableName: string;
      commands: CrudCommand[];
    }> = [];

    // Collect all commands in order they were added
    const allCommands: Array<{
      tableKey: string;
      tableName: string;
      command: CrudCommand;
    }> = [];

    connectionCommands.forEach(([tableKey, commands]) => {
      const parts = tableKey.split(":");
      const tableName = parts[parts.length - 1];
      const schemaName = parts.length > 3 ? parts[2] : undefined;
      const displayName = schemaName
        ? `${schemaName}.${tableName}`
        : tableName || "";

      commands.forEach((cmd) => {
        allCommands.push({
          tableKey,
          tableName: displayName,
          command: cmd,
        });
      });
    });

    // Group by row key while preserving order
    const rowMap = new Map<
      string,
      {
        rowKey: string;
        tableName: string;
        commands: CrudCommand[];
      }
    >();

    allCommands.forEach(({ tableName, command }) => {
      let rowKey: string;

      if (command.type === "data.insert") {
        // For inserts, use command ID as row key
        rowKey = `insert-${command.id}`;
      } else if (command.type === "data.update") {
        // For updates, use primary keys
        const payload = command.payload as {
          primaryKeys?: Record<string, unknown>;
        };
        rowKey = payload.primaryKeys
          ? JSON.stringify(payload.primaryKeys)
          : `update-${command.id}`;
      } else if (command.type === "data.delete") {
        // For deletes, use primary keys
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
        const row = {
          rowKey,
          tableName,
          commands: [],
        };
        rowMap.set(rowKey, row);
        result.push(row);
      }

      const row = rowMap.get(rowKey);
      if (row) {
        row.commands.push(command);
      }
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
      toast.error("Commit failed", {
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
      setIsCommitting(false);
    } finally {
      setIsCommitting(false);
    }
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

        {/* Changes List - Grouped by Row ID */}
        <ScrollArea className="flex-1 -mx-4 px-4 max-h-[60vh] overflow-scroll">
          <div className="space-y-2">
            {groupedByRow.map((row, index) => (
              <RowChangesCard
                key={row.rowKey}
                row={row}
                index={index}
                onUndo={handleUndoRow}
              />
            ))}
          </div>
        </ScrollArea>

        <Separator />

        <DialogFooter className="flex justify-end gap-2">
          {!isTableSpecific && (
            <Button
              size="xs"
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
            size="xs"
            variant={isTableSpecific ? "destructive" : "outline"}
            onClick={handleDiscardAll}
            disabled={isCommitting}
          >
            <IconX className="h-3.5 w-3.5 mr-1.5" />
            {isTableSpecific ? "Discard" : "Discard All"}
          </Button>
          <Button size="xs" onClick={handleCommitAll} disabled={isCommitting}>
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
          size="xs"
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
  if (typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === "number") {
    return String(value);
  }
  return "";
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
