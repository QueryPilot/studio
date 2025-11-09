import { useState, useMemo } from "react";
import { useCrudStore } from "@/stores/crudStore";
import type { CrudCommand } from "@/types/crud";
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
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  CheckCircle2,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import ReactDiffViewer from "react-diff-viewer-continued";

interface GlobalChangesModalProps {
  connectionId: string;
  database?: string;
  schema?: string;
  table?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommitSuccess?: () => void;
}

export function GlobalChangesModal(props: GlobalChangesModalProps) {
  const { connectionId, database, schema, table, open, onOpenChange, onCommitSuccess } = props;
  const { stagedCommands, commitAll, discardAll, getTableKey, commitChanges, discardChanges } = useCrudStore();

  const [isCommitting, setIsCommitting] = useState(false);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  // Check if this is table-specific or workspace-wide
  const isTableSpecific = database !== undefined && table !== undefined;

  // Filter commands based on scope
  const connectionCommands = Array.from(stagedCommands.entries()).filter(
    ([tableKey]) => {
      if (isTableSpecific) {
        const specificTableKey = getTableKey({ connectionId, database: database!, schema, table: table! });
        return tableKey === specificTableKey;
      }
      return tableKey.startsWith(`${connectionId}:`);
    }
  );

  // Group commands by table, then by row
  const groupedByTableAndRow = useMemo(() => {
    const result = new Map<
      string,
      {
        displayName: string;
        rows: Map<
          string,
          {
            rowKey: string;
            commands: CrudCommand[];
          }
        >;
      }
    >();

    connectionCommands.forEach(([tableKey, commands]) => {
      const parts = tableKey.split(":");
      const tableName = parts[parts.length - 1];
      const schemaName = parts.length > 3 ? parts[2] : undefined;
      const displayName = schemaName
        ? `${schemaName}.${tableName}`
        : tableName || "";

      if (!result.has(tableKey)) {
        result.set(tableKey, {
          displayName,
          rows: new Map(),
        });
      }

      const tableGroup = result.get(tableKey);
      if (!tableGroup) return;

      // Group commands by row
      commands.forEach((cmd) => {
        let rowKey: string;

        if (cmd.type === "data.insert") {
          // For inserts, use command ID as row key
          rowKey = `insert-${cmd.id}`;
        } else if (cmd.type === "data.update") {
          // For updates, use primary keys
          const payload = cmd.payload as {
            primaryKeys?: Record<string, unknown>;
          };
          rowKey = payload.primaryKeys
            ? JSON.stringify(payload.primaryKeys)
            : `update-${cmd.id}`;
        } else if (cmd.type === "data.delete") {
          // For deletes, use primary keys
          const payload = cmd.payload as {
            primaryKeys?: Record<string, unknown>;
          };
          rowKey = payload.primaryKeys
            ? JSON.stringify(payload.primaryKeys)
            : `delete-${cmd.id}`;
        } else {
          rowKey = cmd.id;
        }

        if (!tableGroup.rows.has(rowKey)) {
          tableGroup.rows.set(rowKey, {
            rowKey,
            commands: [],
          });
        }

        const row = tableGroup.rows.get(rowKey);
        if (row) {
          row.commands.push(cmd);
        }
      });
    });

    return result;
  }, [connectionCommands]);

  // Calculate total summary
  const totalSummary = {
    updates: 0,
    inserts: 0,
    deletes: 0,
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
    totalSummary.total += commands.length;
  });

  const toggleTable = (tableKey: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableKey)) {
        next.delete(tableKey);
      } else {
        next.add(tableKey);
      }
      return next;
    });
  };

  const handleCommitAll = async () => {
    setIsCommitting(true);
    try {
      if (isTableSpecific) {
        // Table-specific commit
        const tableKey = getTableKey({ connectionId, database: database!, schema, table: table! });
        const result = await commitChanges(tableKey);

        toast.success("Changes committed", {
          description: `Successfully committed ${result.committed.length} change${
            result.committed.length === 1 ? "" : "s"
          } in ${result.durationMs}ms`,
        });
      } else {
        // Workspace-wide commit
        const results = await commitAll();
        const totalCommitted = Object.values(results).reduce(
          (sum, result) => sum + result.committed.length,
          0,
        );

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
      console.error("❌ Commit failed:", error);
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
      const tableKey = getTableKey({ connectionId, database: database!, schema, table: table! });
      discardChanges(tableKey);
      toast.success("Changes discarded");
    } else {
      discardAll();
      toast.success("All changes discarded");
    }
    onOpenChange(false);
  };

  if (connectionCommands.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[80vw] max-h-[80vh] flex flex-col p-4">
        <DialogHeader>
          <DialogTitle>
            {isTableSpecific ? "Commit changes" : "Review All Changes"}
          </DialogTitle>
          <DialogDescription>
            {isTableSpecific
              ? "Review the changes that will be committed to the database."
              : "Review and commit all pending changes across all tables"
            }
          </DialogDescription>
        </DialogHeader>

        {/* Summary Statistics */}
        <div className="grid grid-cols-4 gap-3">
          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-semibold">{totalSummary.total}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10">
              <Pencil className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Updates</p>
              <p className="text-lg font-semibold">{totalSummary.updates}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10">
              <Plus className="h-4 w-4 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Inserts</p>
              <p className="text-lg font-semibold">{totalSummary.inserts}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10">
              <Trash2 className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Deletes</p>
              <p className="text-lg font-semibold">{totalSummary.deletes}</p>
            </div>
          </div>
        </div>

        {/* Tables List - Grouped by Table and Row */}
        <ScrollArea className="flex-1 -mx-4 px-4 max-h-[60vh] overflow-scroll">
          <div className="space-y-3">
            {Array.from(groupedByTableAndRow.entries()).map(
              ([tableKey, tableGroup]) => {
                const isExpanded = expandedTables.has(tableKey);
                const totalChanges = Array.from(tableGroup.rows.values()).reduce(
                  (sum, row) => sum + row.commands.length,
                  0,
                );

                return (
                  <div key={tableKey} className="space-y-2">
                    {/* Table Header */}
                    <button
                      onClick={() => {
                        toggleTable(tableKey);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-medium hover:bg-accent border"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <span className="font-semibold">
                        {tableGroup.displayName}
                      </span>
                      <span className="ml-auto text-sm text-muted-foreground">
                        {totalChanges}{" "}
                        {totalChanges === 1 ? "change" : "changes"} •{" "}
                        {tableGroup.rows.size}{" "}
                        {tableGroup.rows.size === 1 ? "row" : "rows"}
                      </span>
                    </button>

                    {/* Rows */}
                    {isExpanded && (
                      <div className="ml-4 space-y-2">
                        {Array.from(tableGroup.rows.values()).map((row) => (
                          <RowChangesCard key={row.rowKey} row={row} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              },
            )}
          </div>
        </ScrollArea>

        <Separator />

        <DialogFooter className="flex justify-end gap-2">
          {!isTableSpecific && (
            <Button
              size="xs"
              variant="outline"
              onClick={() => onOpenChange(false)}
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
            <X className="h-3.5 w-3.5 mr-1.5" />
            {isTableSpecific ? "Discard" : "Discard All"}
          </Button>
          <Button size="xs" onClick={handleCommitAll} disabled={isCommitting}>
            {isCommitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Committing...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Commit {totalSummary.total} {totalSummary.total === 1 ? "Change" : "Changes"}
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
    commands: CrudCommand[];
  };
}

function RowChangesCard({ row }: RowChangesCardProps) {
  // Determine the operation type (insert, update, delete)
  const hasInsert = row.commands.some((cmd) => cmd.type === "data.insert");
  const hasDelete = row.commands.some((cmd) => cmd.type === "data.delete");
  const hasUpdate = row.commands.some((cmd) => cmd.type === "data.update");

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
          return `${key}: ${formatted.length > 100 ? truncateMiddle(formatted, 100) : formatted}`;
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
          return `${key}: ${formatted.length > 100 ? truncateMiddle(formatted, 100) : formatted}`;
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
          column
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
    <div className="rounded-lg border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
        {hasInsert && (
          <>
            <Plus className="h-3.5 w-3.5 text-green-500" />
            <span className="text-sm font-medium text-green-600 dark:text-green-400">
              Insert Row
            </span>
          </>
        )}
        {hasDelete && (
          <>
            <Trash2 className="h-3.5 w-3.5 text-red-500" />
            <span className="text-sm font-medium text-red-600 dark:text-red-400">
              Delete Row
            </span>
            {pkInfo && (
              <span className="text-xs text-muted-foreground ml-2">
                WHERE {pkInfo}
              </span>
            )}
          </>
        )}
        {hasUpdate && (
          <>
            <Pencil className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
              Update Row
            </span>
            {pkInfo && (
              <span className="text-xs text-muted-foreground ml-2">
                WHERE {pkInfo}
              </span>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {row.commands.length}{" "}
              {row.commands.length === 1 ? "field" : "fields"}
            </span>
          </>
        )}
      </div>

      {/* Diff Viewer */}
      <div className="text-[11px] [&_.diff-viewer]:!text-[11px] [&_.diff-viewer]:!font-mono">
        <ReactDiffViewer
          oldValue={old}
          newValue={newVal}
          splitView={true}
          hideLineNumbers={true}
          showDiffOnly={false}
          useDarkTheme={
            document.documentElement.classList.contains("dark") ||
            window.matchMedia("(prefers-color-scheme: dark)").matches
          }
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
    return `"${value}"`;
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
  newValue: unknown
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
      old: oldStr.length > MAX_LENGTH ? truncateMiddle(oldStr, MAX_LENGTH) : oldStr,
      new: newStr.length > MAX_LENGTH ? truncateMiddle(newStr, MAX_LENGTH) : newStr,
    };
  }

  // Find common prefix and suffix
  const { prefix, suffix, oldMiddle, newMiddle } = findDiff(oldStr, newStr);

  const CONTEXT_LENGTH = 30;
  const prefixContext = prefix.length > CONTEXT_LENGTH
    ? "..." + prefix.slice(-CONTEXT_LENGTH)
    : prefix;
  const suffixContext = suffix.length > CONTEXT_LENGTH
    ? suffix.slice(0, CONTEXT_LENGTH) + "..."
    : suffix;

  // If the middle parts are still too long, truncate them
  const oldMiddleTruncated = oldMiddle.length > MAX_LENGTH
    ? truncateMiddle(oldMiddle, MAX_LENGTH)
    : oldMiddle;
  const newMiddleTruncated = newMiddle.length > MAX_LENGTH
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
function findDiff(str1: string, str2: string): {
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
