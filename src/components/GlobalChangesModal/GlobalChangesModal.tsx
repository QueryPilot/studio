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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommitSuccess?: () => void;
}

export function GlobalChangesModal(props: GlobalChangesModalProps) {
  const { connectionId, open, onOpenChange, onCommitSuccess } = props;
  const { stagedCommands, commitAll, discardAll } = useCrudStore();

  const [isCommitting, setIsCommitting] = useState(false);
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  // Filter commands for this connection and group by table and row
  const connectionCommands = Array.from(stagedCommands.entries()).filter(
    ([tableKey]) => tableKey.startsWith(`${connectionId}:`),
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

      const tableGroup = result.get(tableKey)!;

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

        tableGroup.rows.get(rowKey)!.commands.push(cmd);
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
    discardAll();
    toast.success("All changes discarded");
    onOpenChange(false);
  };

  if (connectionCommands.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[80vw] max-h-[80vh] flex flex-col p-4">
        <DialogHeader>
          <DialogTitle>Review All Changes</DialogTitle>
          <DialogDescription>
            Review and commit all pending changes across all tables
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
          <Button
            size="xs"
            variant="outline"
            onClick={handleDiscardAll}
            disabled={isCommitting}
          >
            <X className="h-3.5 w-3.5 mr-1.5" />
            Discard All
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
                Commit {totalSummary.total} Changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DiffCardProps {
  command: CrudCommand;
}

function DiffCard({ command }: DiffCardProps) {
  const payload = command.payload as Record<string, unknown>;

  return (
    <div className="rounded-lg border bg-card p-2 text-xs">
      <div className="flex items-center gap-2 text-muted-foreground">
        {getOperationIcon(command.type)}
        <span className="font-mono">
          {command.metadata.description || command.type}
        </span>
      </div>

      {command.type === "data.update" && (
        <div className="mt-1 ml-5">
          <span className="font-mono text-[10px]">
            {payload.column as string}:{" "}
            <span className="text-red-600">
              {formatValue(payload.oldValue)}
            </span>{" "}
            →{" "}
            <span className="text-green-600">
              {formatValue(payload.newValue)}
            </span>
          </span>
        </div>
      )}

      {command.type === "data.insert" && (
        <div className="mt-1 ml-5 text-[10px] font-mono text-green-600">
          New row
        </div>
      )}

      {command.type === "data.delete" && (
        <div className="mt-1 ml-5 text-[10px] font-mono text-red-600">
          Delete row
        </div>
      )}
    </div>
  );
}

function getOperationIcon(operationType: string) {
  switch (operationType) {
    case "data.update":
      return <Pencil className="h-3 w-3 text-blue-500" />;
    case "data.insert":
      return <Plus className="h-3 w-3 text-green-500" />;
    case "data.delete":
      return <Trash2 className="h-3 w-3 text-red-500" />;
    default:
      return null;
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "string") {
    return `"${value.length > 20 ? value.substring(0, 20) + "..." : value}"`;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "object") {
    return JSON.stringify(value).substring(0, 30) + "...";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}
