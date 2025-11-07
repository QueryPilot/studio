import { useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";

interface CommitPreviewModalProps {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommitSuccess?: () => void;
}

export function CommitPreviewModal(props: CommitPreviewModalProps) {
  const {
    connectionId,
    database,
    schema,
    table,
    open,
    onOpenChange,
    onCommitSuccess,
  } = props;
  const { stagedCommands, getTableKey, commitChanges } = useCrudStore();

  const [isCommitting, setIsCommitting] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["data.update", "data.insert", "data.delete"]),
  );

  const tableKey = getTableKey({ connectionId, database, schema, table });
  const commands = stagedCommands.get(tableKey) ?? [];

  // Group commands by type
  const groupedCommands = commands.reduce<Record<string, CrudCommand[]>>(
    (acc, cmd) => {
      if (!acc[cmd.type]) {
        acc[cmd.type] = [];
      }
      acc[cmd.type]!.push(cmd);
      return acc;
    },
    {},
  );

  // Calculate summary statistics
  const summary = {
    updates: commands.filter((c) => c.type === "data.update").length,
    inserts: commands.filter((c) => c.type === "data.insert").length,
    deletes: commands.filter((c) => c.type === "data.delete").length,
    total: commands.length,
  };

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const handleCommit = async () => {
    setIsCommitting(true);
    try {
      const result = await commitChanges(tableKey);

      // Show success toast
      toast.success("Changes committed", {
        description: `Successfully committed ${result.committed.length} change${
          result.committed.length === 1 ? "" : "s"
        } in ${result.durationMs}ms`,
      });

      onOpenChange(false);

      // Refresh table data after successful commit
      if (onCommitSuccess) {
        onCommitSuccess();
      }
    } catch (error) {
      console.error("❌ Commit failed:", error);

      // Show error toast
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      toast.error("Commit failed", {
        description: errorMessage,
      });

      // Don't close modal on error so user can see the changes still
      setIsCommitting(false);
      return;
    } finally {
      setIsCommitting(false);
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  if (commands.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-[80vw] max-h-[80vh] flex flex-col p-4">
        <DialogHeader>
          <DialogTitle>Commit changes</DialogTitle>
          <DialogDescription>
            Review the changes that will be committed to the database.
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
              <p className="text-lg font-semibold">{summary.total}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10">
              <Pencil className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Updates</p>
              <p className="text-lg font-semibold">{summary.updates}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10">
              <Plus className="h-4 w-4 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Inserts</p>
              <p className="text-lg font-semibold">{summary.inserts}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border bg-card p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500/10">
              <Trash2 className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Deletes</p>
              <p className="text-lg font-semibold">{summary.deletes}</p>
            </div>
          </div>
        </div>

        {/* Commands List */}
        <ScrollArea className="flex-1 -mx-4 px-4 max-h-[60vh] overflow-scroll">
          <div className="space-y-2">
            {Object.entries(groupedCommands).map(([type, typeCommands]) => (
              <div key={type} className="space-y-2">
                <button
                  onClick={() => {
                    toggleGroup(type);
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-medium hover:bg-accent"
                >
                  {expandedGroups.has(type) ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {getOperationIcon(type)}
                  <span className="capitalize">
                    {type.replace("data.", "")}
                  </span>
                  <span className="ml-auto text-sm text-muted-foreground">
                    {typeCommands.length}{" "}
                    {typeCommands.length === 1 ? "change" : "changes"}
                  </span>
                </button>

                {expandedGroups.has(type) && (
                  <div className="space-y-2">
                    {typeCommands.map((cmd) => (
                      <DiffCard key={cmd.id} command={cmd} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        <Separator />

        <DialogFooter className="flex justify-end gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={handleCancel}
            disabled={isCommitting}
          >
            Cancel
          </Button>
          <Button size="xs" onClick={handleCommit} disabled={isCommitting}>
            {isCommitting ? "Committing..." : `Commit ${summary.total} Changes`}
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
    <div className="rounded-lg border bg-card">
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5">{getOperationIcon(command.type)}</div>

        <div className="flex-1 min-w-0 space-y-2">
          {/* Header */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {command.metadata.description || command.type}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(command.metadata.timestamp).toLocaleTimeString()}
            </span>
          </div>

          {/* Diff Content */}
          {command.type === "data.update" && (
            <UpdateDiff
              column={payload.column as string}
              oldValue={payload.oldValue}
              newValue={payload.newValue}
              primaryKeys={payload.primaryKeys as Record<string, unknown>}
            />
          )}

          {command.type === "data.insert" && (
            <InsertDiff values={payload.values as Record<string, unknown>} />
          )}

          {command.type === "data.delete" && (
            <DeleteDiff
              primaryKeys={payload.primaryKeys as Record<string, unknown>}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface UpdateDiffProps {
  column: string;
  oldValue: unknown;
  newValue: unknown;
  primaryKeys: Record<string, unknown>;
}

function UpdateDiff({
  column,
  oldValue,
  newValue,
  primaryKeys,
}: UpdateDiffProps) {
  return (
    <div className="space-y-1.5">
      {/* Primary Keys */}
      <div className="text-xs text-muted-foreground">
        WHERE{" "}
        {Object.entries(primaryKeys)
          .map(([k, v]) => `${k} = ${formatValue(v)}`)
          .join(" AND ")}
      </div>

      {/* Column */}
      <div className="font-mono text-xs font-medium">{column}</div>

      {/* Diff */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 p-2">
          <div className="mb-1 text-[10px] font-medium text-red-600 dark:text-red-400">
            OLD VALUE
          </div>
          <div className="font-mono text-xs text-red-900 dark:text-red-300 break-all">
            {formatValue(oldValue)}
          </div>
        </div>

        <div className="rounded border border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/20 p-2">
          <div className="mb-1 text-[10px] font-medium text-green-600 dark:text-green-400">
            NEW VALUE
          </div>
          <div className="font-mono text-xs text-green-900 dark:text-green-300 break-all">
            {formatValue(newValue)}
          </div>
        </div>
      </div>
    </div>
  );
}

interface InsertDiffProps {
  values: Record<string, unknown>;
}

function InsertDiff({ values }: InsertDiffProps) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">New row values:</div>
      <div className="rounded border border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/20 p-2">
        <dl className="space-y-1">
          {Object.entries(values).map(([key, value]) => (
            <div key={key} className="flex gap-2 text-xs">
              <dt className="font-mono font-medium text-green-700 dark:text-green-400">
                {key}:
              </dt>
              <dd className="font-mono text-green-900 dark:text-green-300 break-all">
                {formatValue(value)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

interface DeleteDiffProps {
  primaryKeys: Record<string, unknown>;
}

function DeleteDiff({ primaryKeys }: DeleteDiffProps) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">Row to be deleted:</div>
      <div className="rounded border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20 p-2">
        <div className="font-mono text-xs text-red-900 dark:text-red-300">
          WHERE{" "}
          {Object.entries(primaryKeys)
            .map(([k, v]) => `${k} = ${formatValue(v)}`)
            .join(" AND ")}
        </div>
      </div>
    </div>
  );
}

function getOperationIcon(operationType: string) {
  switch (operationType) {
    case "data.update":
      return <Pencil className="h-4 w-4 text-blue-500" />;
    case "data.insert":
      return <Plus className="h-4 w-4 text-green-500" />;
    case "data.delete":
      return <Trash2 className="h-4 w-4 text-red-500" />;
    default:
      return null;
  }
}

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
    return JSON.stringify(value);
  }
  // At this point, value should be string, number, or other primitive
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return "";
}
