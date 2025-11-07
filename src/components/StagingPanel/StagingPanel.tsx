import { useState } from "react";
import { useCrudStore } from "@/stores/crudStore";
import type { CrudCommand } from "@/types/crud";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Trash2,
  X,
  Check,
  Undo2,
  Redo2,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface StagingPanelProps {
  connectionId: string;
  database: string;
  schema?: string;
  table: string;
}

export function StagingPanel(props: StagingPanelProps) {
  const { connectionId, database, schema, table } = props;
  const {
    stagedCommands,
    getTableKey,
    unstageCommand,
    discardChanges,
    commitChanges,
    undo,
    redo,
    historyIndex,
    history,
  } = useCrudStore();

  const tableKey = getTableKey({ connectionId, database, schema, table });
  const commands = stagedCommands.get(tableKey) ?? [];

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["data.update", "data.insert", "data.delete"]),
  );

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  // Group commands by operation type
  const groupedCommands = commands.reduce<Record<string, CrudCommand[]>>(
    (acc, cmd) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const group = cmd.type.split(".")[0]!; // "data", "column", etc.
      if (!acc[group]) {
        acc[group] = [];
      }
      acc[group].push(cmd);
      return acc;
    },
    {},
  );

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
    await commitChanges(tableKey);
  };

  const handleDiscard = () => {
    discardChanges(tableKey);
  };

  if (commands.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-muted-foreground">
        <p className="text-sm">No pending changes</p>
        <p className="mt-1 text-xs">Edit cells to stage changes</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Pending Changes</h3>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {commands.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  undo();
                }}
                disabled={!canUndo}
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo (Cmd+Z)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  redo();
                }}
                disabled={!canRedo}
              >
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo (Cmd+Shift+Z)</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Commands List */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {Object.entries(groupedCommands).map(([group, groupCommands]) => (
            <div key={group} className="mb-2">
              <button
                onClick={() => {
                  toggleGroup(group);
                }}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm font-medium hover:bg-accent"
              >
                {expandedGroups.has(group) ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <span className="capitalize">{group}</span>
                <span className="text-xs text-muted-foreground">
                  ({groupCommands.length})
                </span>
              </button>

              {expandedGroups.has(group) && (
                <div className="ml-2 mt-1 space-y-1">
                  {groupCommands.map((cmd) => (
                    <CommandItem
                      key={cmd.id}
                      command={cmd}
                      onUnstage={() => {
                        unstageCommand(cmd.id);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Actions Footer */}
      <div className="flex items-center gap-2 border-t p-3">
        <Button
          variant="default"
          size="sm"
          className="flex-1"
          onClick={handleCommit}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" />
          Commit All
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={handleDiscard}
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
          Discard All
        </Button>
      </div>
    </div>
  );
}

interface CommandItemProps {
  command: CrudCommand;
  onUnstage: () => void;
}

function CommandItem({ command, onUnstage }: CommandItemProps) {
  const icon = getOperationIcon(command.type);
  const description = getCommandDescription(command);
  const preview = getCommandPreview(command);

  return (
    <div className="group relative flex items-start gap-2 rounded border bg-card p-2 text-xs hover:border-primary/50">
      <div className="mt-0.5 flex-shrink-0">{icon}</div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{description}</span>
          <span className="text-[10px] text-muted-foreground">
            {new Date(command.metadata.timestamp).toLocaleTimeString()}
          </span>
        </div>

        {preview && (
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {preview}
          </div>
        )}
      </div>

      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={onUnstage}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

function getOperationIcon(operationType: string) {
  switch (operationType) {
    case "data.update":
      return <Pencil className="h-3.5 w-3.5 text-blue-500" />;
    case "data.insert":
      return <Plus className="h-3.5 w-3.5 text-green-500" />;
    case "data.delete":
      return <Trash2 className="h-3.5 w-3.5 text-red-500" />;
    default:
      return null;
  }
}

function getCommandDescription(command: CrudCommand): string {
  if (command.metadata.description) {
    return command.metadata.description;
  }

  switch (command.type) {
    case "data.update":
      return "Update cell";
    case "data.insert":
      return "Insert row";
    case "data.delete":
      return "Delete row";
    default:
      return command.type;
  }
}

function getCommandPreview(command: CrudCommand): string | null {
  const payload = command.payload as Record<string, unknown>;

  switch (command.type) {
    case "data.update": {
      const column = payload.column;
      const oldValue = payload.oldValue;
      const newValue = payload.newValue;
      return `${column}: ${formatValue(oldValue)} → ${formatValue(newValue)}`;
    }

    case "data.insert": {
      const values = payload.values as Record<string, unknown> | undefined;
      if (!values) return null;
      const keys = Object.keys(values);
      const preview = keys.slice(0, 3).join(", ");
      return keys.length > 3 ? `${preview}, ...` : preview;
    }

    case "data.delete": {
      const primaryKeys = payload.primaryKeys as
        | Record<string, unknown>
        | undefined;
      if (!primaryKeys) return null;
      return Object.entries(primaryKeys)
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(", ");
    }

    default:
      return null;
  }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  return "[Unknown]";
}
