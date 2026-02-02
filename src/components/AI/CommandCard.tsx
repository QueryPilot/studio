/**
 * Command Card Component
 *
 * Displays AI commands inline with approve/reject actions.
 * Shows execution status and results.
 */

import { useState, useEffect } from "react";
import {
  IconCheck,
  IconX,
  IconPlayerPlay,
  IconLoader2,
  IconChevronDown,
  IconChevronRight,
  IconDatabase,
  IconBrandMongodb,
  IconServer,
  IconTable,
  IconCode,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ParsedCommand } from "@/types/aiCommands";
import { COMMAND_META } from "@/types/aiCommands";
import { getCommandDescription, validateCommand } from "@/utils/aiCommandParser";
import { useAiCommandPermissionStore, type CommandState } from "@/stores/aiCommandPermissionStore";
import { executeCommand, formatResultForConversation } from "@/services/aiCommandExecutor";

interface CommandCardProps {
  command: ParsedCommand;
  onResult?: (result: string) => void;
}

export function CommandCard({ command, onResult }: CommandCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [localState, setLocalState] = useState<CommandState>("pending");

  const {
    trackCommand,
    approveCommand,
    rejectCommand,
    setCommandState,
    getCommandState,
    shouldAutoApprove,
  } = useAiCommandPermissionStore();

  const state = getCommandState(command.id);
  const meta = COMMAND_META[command.name];
  const description = getCommandDescription(command);
  const validationError = validateCommand(command);

  // Sync local state with store
  useEffect(() => {
    setLocalState(state);
  }, [state]);

  // Track command on mount
  useEffect(() => {
    trackCommand(command.id, command.name);

    // Auto-approve if eligible
    if (shouldAutoApprove(command.name) && !command.error && !validationError) {
      void handleApprove();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command.id]);

  const handleApprove = async () => {
    if (command.error || validationError) return;

    setLocalState("executing");
    setCommandState(command.id, "executing");

    const execResult = await executeCommand(command);
    const formatted = formatResultForConversation(command, execResult);

    setResult(formatted);
    const finalState = execResult.success ? "completed" : "failed";
    setLocalState(finalState);
    setCommandState(command.id, finalState);
    approveCommand(command.id);
    onResult?.(formatted);
  };

  const handleReject = () => {
    setLocalState("rejected");
    rejectCommand(command.id);
    setCommandState(command.id, "rejected");
  };

  // Get paradigm icon
  const getIcon = () => {
    switch (meta?.paradigm) {
      case "sql":
        return IconDatabase;
      case "document":
        return IconBrandMongodb;
      case "keyvalue":
        return IconServer;
      case "universal":
        return command.name.startsWith("crud") ? IconTable : IconCode;
      default:
        return IconCode;
    }
  };

  const Icon = getIcon();

  // Render based on state
  if (localState === "completed" || localState === "failed") {
    return (
      <div className={cn(
        "rounded-md border my-2 overflow-hidden",
        localState === "completed" ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
      )}>
        <div className="flex items-center gap-2 px-3 py-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-xs">{description}</span>
          {localState === "completed" ? (
            <IconCheck className="h-4 w-4 text-green-500" />
          ) : (
            <IconX className="h-4 w-4 text-red-500" />
          )}
        </div>
        {result && (
          <div className="px-3 pb-3 text-xs border-t border-border/50">
            <div className="pt-2 prose prose-sm dark:prose-invert max-w-none">
              <pre className="whitespace-pre-wrap text-[11px] bg-transparent p-0 m-0">{result}</pre>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (localState === "rejected") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1 opacity-50">
        <Icon className="h-3.5 w-3.5" />
        <span className="line-through">{description}</span>
        <span>- Rejected</span>
      </div>
    );
  }

  if (localState === "executing") {
    return (
      <div className="rounded-md border bg-muted/30 my-2">
        <div className="flex items-center gap-2 px-3 py-2">
          <IconLoader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="flex-1 text-xs">{description}</span>
          <span className="text-[10px] text-muted-foreground">Executing...</span>
        </div>
      </div>
    );
  }

  // Pending state - show approval UI
  return (
    <div className="rounded-md border bg-muted/30 my-2">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <IconChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <IconChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <Icon className="h-4 w-4 text-primary" />
        <span className="flex-1 text-xs font-medium">{description}</span>

        {(command.error || validationError) ? (
          <span className="text-[10px] text-destructive">
            {command.error || validationError}
          </span>
        ) : (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                void handleApprove();
              }}
            >
              <IconPlayerPlay className="h-3 w-3 mr-1" />
              Run
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-muted-foreground"
              onClick={(e) => {
                e.stopPropagation();
                handleReject();
              }}
            >
              <IconX className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t">
          <pre className="text-[10px] bg-background rounded p-2 overflow-x-auto">
            {JSON.stringify(command.params, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

interface CommandListProps {
  commands: ParsedCommand[];
  onResult?: (commandId: string, result: string) => void;
}

export function CommandList({ commands, onResult }: CommandListProps) {
  const { allowAllThisConversation, setAllowAll } = useAiCommandPermissionStore();
  const getCommandState = useAiCommandPermissionStore((s) => s.getCommandState);

  if (commands.length === 0) return null;

  const pendingCount = commands.filter(
    (c) => !c.error && getCommandState(c.id) === "pending"
  ).length;

  return (
    <div className="space-y-1">
      {pendingCount > 1 && !allowAllThisConversation && (
        <div className="flex justify-end mb-2">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px]"
            onClick={() => setAllowAll(true)}
          >
            Allow all this conversation
          </Button>
        </div>
      )}
      {commands.map((cmd) => (
        <CommandCard
          key={cmd.id}
          command={cmd}
          onResult={(result) => onResult?.(cmd.id, result)}
        />
      ))}
    </div>
  );
}
