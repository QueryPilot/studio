/**
 * Command Card Component
 *
 * Displays AI commands inline with approve/reject actions.
 * Shows execution status and results.
 * Enhanced parameter preview with syntax highlighting and validation.
 */

import { useState, useEffect, useMemo, useRef, useCallback, Component, type ReactNode, type ErrorInfo } from "react";
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
  IconAlertTriangle,
  IconInfoCircle,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ParsedCommand, ParamSchema } from "@/types/aiCommands";
import { COMMAND_META } from "@/types/aiCommands";
import { getCommandDescription, validateCommand } from "@/utils/aiCommandParser";
import { useAiCommandPermissionStore, type CommandState } from "@/stores/aiCommandPermissionStore";
import {
  executeCommandWithTimeout,
  formatResultForConversation,
  executeCommandsInParallel,
  formatBatchedResultsForAgent,
} from "@/services/aiCommandExecutor";

// ============================================================================
// JSON Syntax Highlighting
// ============================================================================

type JsonTokenType = "key" | "string" | "number" | "boolean" | "null" | "punctuation";

interface JsonToken {
  type: JsonTokenType;
  value: string;
}

/**
 * Tokenize JSON string for syntax highlighting.
 */
function tokenizeJson(jsonStr: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const lines = jsonStr.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Match different JSON parts
    let remaining = line;
    while (remaining.length > 0) {
      // Match key (quoted string followed by colon)
      const keyMatch = remaining.match(/^(\s*)("(?:[^"\\]|\\.)*")(\s*:)/);
      if (keyMatch) {
        if (keyMatch[1]) tokens.push({ type: "punctuation", value: keyMatch[1] });
        tokens.push({ type: "key", value: keyMatch[2] ?? "" });
        tokens.push({ type: "punctuation", value: keyMatch[3] ?? "" });
        remaining = remaining.slice(keyMatch[0].length);
        continue;
      }

      // Match string value
      const stringMatch = remaining.match(/^(\s*)("(?:[^"\\]|\\.)*")/);
      if (stringMatch) {
        if (stringMatch[1]) tokens.push({ type: "punctuation", value: stringMatch[1] });
        tokens.push({ type: "string", value: stringMatch[2] ?? "" });
        remaining = remaining.slice(stringMatch[0].length);
        continue;
      }

      // Match number
      const numberMatch = remaining.match(/^(\s*)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/);
      if (numberMatch) {
        if (numberMatch[1]) tokens.push({ type: "punctuation", value: numberMatch[1] });
        tokens.push({ type: "number", value: numberMatch[2] ?? "" });
        remaining = remaining.slice(numberMatch[0].length);
        continue;
      }

      // Match boolean
      const boolMatch = remaining.match(/^(\s*)(true|false)/);
      if (boolMatch) {
        if (boolMatch[1]) tokens.push({ type: "punctuation", value: boolMatch[1] });
        tokens.push({ type: "boolean", value: boolMatch[2] ?? "" });
        remaining = remaining.slice(boolMatch[0].length);
        continue;
      }

      // Match null
      const nullMatch = remaining.match(/^(\s*)(null)/);
      if (nullMatch) {
        if (nullMatch[1]) tokens.push({ type: "punctuation", value: nullMatch[1] });
        tokens.push({ type: "null", value: nullMatch[2] ?? "" });
        remaining = remaining.slice(nullMatch[0].length);
        continue;
      }

      // Match punctuation (braces, brackets, commas)
      const punctMatch = remaining.match(/^(\s*[[{}\],:]+)/);
      if (punctMatch) {
        tokens.push({ type: "punctuation", value: punctMatch[1] ?? "" });
        remaining = remaining.slice(punctMatch[0].length);
        continue;
      }

      // Match whitespace
      const wsMatch = remaining.match(/^(\s+)/);
      if (wsMatch) {
        tokens.push({ type: "punctuation", value: wsMatch[1] ?? "" });
        remaining = remaining.slice(wsMatch[0].length);
        continue;
      }

      // Fallback: consume one character
      tokens.push({ type: "punctuation", value: remaining[0] ?? "" });
      remaining = remaining.slice(1);
    }

    // Add newline between lines (except last)
    if (i < lines.length - 1) {
      tokens.push({ type: "punctuation", value: "\n" });
    }
  }

  return tokens;
}

const TOKEN_COLORS: Record<JsonTokenType, string> = {
  key: "text-blue-400",
  string: "text-green-400",
  number: "text-amber-400",
  boolean: "text-purple-400",
  null: "text-gray-400",
  punctuation: "text-muted-foreground",
};

/**
 * Render highlighted JSON.
 */
function HighlightedJson({ json }: { json: string }) {
  const tokens = useMemo(() => tokenizeJson(json), [json]);

  return (
    <pre className="text-[10px] bg-background rounded p-2 overflow-x-auto font-mono leading-relaxed">
      {tokens.map((token, i) => (
        <span key={i} className={TOKEN_COLORS[token.type]}>
          {token.value}
        </span>
      ))}
    </pre>
  );
}

// ============================================================================
// Parameter Validation Display
// ============================================================================

interface ValidationResult {
  errors: string[];
  warnings: string[];
  missingRequired: string[];
}

/**
 * Validate parameters against schema.
 */
function validateParams(
  params: Record<string, unknown>,
  schema: ParamSchema[] | undefined
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const missingRequired: string[] = [];

  if (!schema) {
    return { errors, warnings, missingRequired };
  }

  for (const paramDef of schema) {
    const value = params[paramDef.name];

    if (paramDef.required && (value === undefined || value === null || value === "")) {
      missingRequired.push(paramDef.name);
      errors.push(`Missing required parameter: ${paramDef.name}`);
    } else if (value !== undefined && value !== null) {
      // Type checking
      const actualType = Array.isArray(value) ? "array" : typeof value;
      if (paramDef.type === "object" && actualType !== "object") {
        warnings.push(`${paramDef.name}: expected object, got ${actualType}`);
      } else if (paramDef.type === "array" && actualType !== "array") {
        warnings.push(`${paramDef.name}: expected array, got ${actualType}`);
      } else if (paramDef.type === "number" && actualType !== "number") {
        warnings.push(`${paramDef.name}: expected number, got ${actualType}`);
      } else if (paramDef.type === "boolean" && actualType !== "boolean") {
        warnings.push(`${paramDef.name}: expected boolean, got ${actualType}`);
      } else if (paramDef.type === "string" && actualType !== "string") {
        warnings.push(`${paramDef.name}: expected string, got ${actualType}`);
      }
    }
  }

  return { errors, warnings, missingRequired };
}

/**
 * Parameter info row component.
 */
function ParamRow({
  param,
  value,
  isMissing,
}: {
  param: ParamSchema;
  value: unknown;
  isMissing: boolean;
}) {
  const hasValue = value !== undefined && value !== null;

  return (
    <div
      className={cn(
        "flex items-start gap-2 py-1 px-2 rounded text-[10px]",
        isMissing && "bg-destructive/10"
      )}
    >
      <div className="flex items-center gap-1 min-w-[100px]">
        <span className={cn("font-medium", isMissing ? "text-destructive" : "text-foreground")}>
          {param.name}
        </span>
        {param.required && (
          <span className="text-destructive text-[8px]">*</span>
        )}
      </div>
      <div className="flex-1 text-muted-foreground truncate">
        {hasValue ? (
          <span className="text-foreground">
            {typeof value === "string"
              ? value.length > 50
                ? `"${value.slice(0, 50)}..."`
                : `"${value}"`
              : JSON.stringify(value)}
          </span>
        ) : (
          <span className="italic">{param.description}</span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Error Boundary for Command Cards
// ============================================================================

interface CommandCardErrorBoundaryProps {
  children: ReactNode;
  commandName: string;
}

interface CommandCardErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class CommandCardErrorBoundary extends Component<CommandCardErrorBoundaryProps, CommandCardErrorBoundaryState> {
  constructor(props: CommandCardErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): CommandCardErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[CommandCard] Error rendering command:", this.props.commandName, error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
          <IconAlertTriangle className="h-3 w-3" />
          <span>Error rendering command: {this.props.commandName}</span>
        </div>
      );
    }
    return this.props.children;
  }
}

// ============================================================================
// Command Card Component
// ============================================================================

interface CommandCardProps {
  command: ParsedCommand;
  onResult?: (result: string) => void;
  /** Pre-computed result from batch execution - skips individual execution */
  batchResult?: string;
}

export function CommandCard(props: CommandCardProps) {
  return (
    <CommandCardErrorBoundary commandName={props.command.name}>
      <CommandCardInner {...props} />
    </CommandCardErrorBoundary>
  );
}

function CommandCardInner({ command, onResult, batchResult }: CommandCardProps) {
  const meta = COMMAND_META[command.name];

  // Handle unknown commands gracefully
  if (!meta) {
    return (
      <div className="flex items-center gap-2 p-2 rounded bg-muted/50 text-muted-foreground text-xs">
        <IconAlertTriangle className="h-3 w-3" />
        <span>Unknown command: {command.name}</span>
      </div>
    );
  }

  // Auto-expand for "approve" level commands (user needs to review)
  const shouldAutoExpand = meta.approvalLevel === "approve";
  const [expanded, setExpanded] = useState(shouldAutoExpand);
  const [showParamDetails, setShowParamDetails] = useState(false);
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
  const description = getCommandDescription(command);
  const validationError = validateCommand(command);

  // Validate parameters against schema
  const paramValidation = useMemo(
    () => validateParams(command.params as Record<string, unknown>, meta.params),
    [command.params, meta.params]
  );

  const hasValidationIssues = paramValidation.errors.length > 0 || paramValidation.warnings.length > 0;

  // Track if we've already attempted auto-approval to prevent double execution
  const autoApproveAttempted = useRef(false);
  // Track if we've already tracked this command
  const commandTracked = useRef(false);

  // Sync local state with store
  useEffect(() => {
    setLocalState(state);
  }, [state]);

  // Use batch result if provided (from parallel execution)
  useEffect(() => {
    if (batchResult && !result) {
      setResult(batchResult);
    }
  }, [batchResult, result]);

  // Handle command approval with proper error handling
  const handleApprove = useCallback(async () => {
    if (command.error || validationError) return;
    if (localState !== "pending") return; // Prevent double execution

    setLocalState("executing");
    setCommandState(command.id, "executing");

    try {
      // Use 30s timeout for all command executions
      const execResult = await executeCommandWithTimeout(command, 30_000);
      const formatted = formatResultForConversation(command, execResult);

      setResult(formatted);
      const finalState = execResult.success ? "completed" : "failed";
      setLocalState(finalState);
      setCommandState(command.id, finalState);
      approveCommand(command.id);
      onResult?.(formatted);
    } catch (error) {
      // Handle unexpected errors (network issues, etc.)
      const errorMessage = error instanceof Error ? error.message : String(error);
      setResult(`**Error:** ${errorMessage}`);
      setLocalState("failed");
      setCommandState(command.id, "failed");
      onResult?.(`**Error:** ${errorMessage}`);
    }
  }, [command, validationError, localState, setCommandState, approveCommand, onResult]);

  // Store latest handleApprove in ref to avoid infinite loop
  const handleApproveRef = useRef(handleApprove);
  useEffect(() => {
    handleApproveRef.current = handleApprove;
  }, [handleApprove]);

  // Track command on mount (separate effect to avoid infinite loop)
  useEffect(() => {
    if (!commandTracked.current) {
      commandTracked.current = true;
      trackCommand(command.id, command.name);
    }
  }, [command.id, command.name, trackCommand]);

  // Handle auto-approval (separate effect)
  // Skip if batchResult exists - means batch execution already handled this command
  useEffect(() => {
    // Auto-approve if eligible (only once per command)
    // Skip if batch execution already handled this command
    if (autoApproveAttempted.current || batchResult) return;

    const canAutoApprove =
      shouldAutoApprove(command.name) &&
      !command.error &&
      !validationError &&
      localState === "pending";

    if (canAutoApprove) {
      autoApproveAttempted.current = true;
      // Use microtask to ensure all state updates are flushed
      queueMicrotask(() => {
        void handleApproveRef.current();
      });
    }
  }, [command.name, command.error, validationError, shouldAutoApprove, localState, batchResult]);

  const handleReject = () => {
    setLocalState("rejected");
    rejectCommand(command.id);
    setCommandState(command.id, "rejected");
  };

  // Get paradigm icon
  const getIcon = () => {
    switch (meta.paradigm) {
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
        onClick={() => { setExpanded(!expanded); }}
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
        <div className="px-3 pb-3 pt-2 border-t border-border/50 space-y-2">
          {/* Validation errors */}
          {paramValidation.errors.length > 0 && (
            <div className="flex items-start gap-2 p-2 rounded bg-destructive/10 text-destructive text-[10px]">
              <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                {paramValidation.errors.map((error, i) => (
                  <div key={i}>{error}</div>
                ))}
              </div>
            </div>
          )}

          {/* Validation warnings */}
          {paramValidation.warnings.length > 0 && (
            <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 text-amber-500 text-[10px]">
              <IconInfoCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                {paramValidation.warnings.map((warning, i) => (
                  <div key={i}>{warning}</div>
                ))}
              </div>
            </div>
          )}

          {/* Parameter details toggle */}
          {meta.params && meta.params.length > 0 && (
            <div className="space-y-1">
              <button
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { setShowParamDetails(!showParamDetails); }}
              >
                {showParamDetails ? (
                  <IconChevronDown className="h-3 w-3" />
                ) : (
                  <IconChevronRight className="h-3 w-3" />
                )}
                <span>Parameter details</span>
                {hasValidationIssues && (
                  <Badge variant="destructive" size="xs" className="ml-1">
                    {paramValidation.errors.length + paramValidation.warnings.length}
                  </Badge>
                )}
              </button>

              {showParamDetails && (
                <div className="bg-background rounded border border-border/50 divide-y divide-border/30">
                  {meta.params.map((param) => (
                    <ParamRow
                      key={param.name}
                      param={param}
                      value={(command.params as Record<string, unknown>)[param.name]}
                      isMissing={paramValidation.missingRequired.includes(param.name)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Syntax highlighted JSON */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">Parameters</span>
              <Badge variant="outline" size="xs">
                {meta.approvalLevel}
              </Badge>
            </div>
            <HighlightedJson json={JSON.stringify(command.params, null, 2)} />
          </div>
        </div>
      )}
    </div>
  );
}

interface CommandListProps {
  commands: ParsedCommand[];
  onResult?: (commandId: string, result: string) => void;
  /** Called with batched results when multiple commands complete in parallel */
  onBatchResult?: (batchedResult: string) => void;
}

export function CommandList({ commands, onResult, onBatchResult }: CommandListProps) {
  const { allowAllThisConversation, setAllowAll, shouldAutoApprove } = useAiCommandPermissionStore();
  const getCommandState = useAiCommandPermissionStore((s) => s.getCommandState);
  const setCommandState = useAiCommandPermissionStore((s) => s.setCommandState);
  const trackCommand = useAiCommandPermissionStore((s) => s.trackCommand);
  const approveCommand = useAiCommandPermissionStore((s) => s.approveCommand);

  // Track if we've already run batch execution
  const batchExecuted = useRef(false);
  const [batchResults, setBatchResults] = useState<Map<string, string>>(new Map());

  // Get commands eligible for auto-execution
  const autoExecCommands = useMemo(() => {
    return commands.filter(
      (c) => !c.error && shouldAutoApprove(c.name) && getCommandState(c.id) === "pending"
    );
  }, [commands, shouldAutoApprove, getCommandState]);

  // Run parallel batch execution for auto-approved commands
  useEffect(() => {
    if (batchExecuted.current || autoExecCommands.length === 0) return;

    // Only batch if we have multiple commands to execute
    if (autoExecCommands.length >= 2) {
      batchExecuted.current = true;

      // Track and mark all as executing
      for (const cmd of autoExecCommands) {
        trackCommand(cmd.id, cmd.name);
        setCommandState(cmd.id, "executing");
      }

      // Execute in parallel with 30s timeout each
      void executeCommandsInParallel(autoExecCommands, 30_000).then((batchResult) => {
        const newResults = new Map<string, string>();

        // Update individual command states
        for (const item of batchResult.results) {
          const cmd = autoExecCommands.find((c) => c.id === item.commandId);
          if (cmd) {
            const formatted = formatResultForConversation(cmd, item.result);
            newResults.set(cmd.id, formatted);

            const finalState = item.result.success ? "completed" : "failed";
            setCommandState(cmd.id, finalState);
            approveCommand(cmd.id);
            onResult?.(cmd.id, formatted);
          }
        }

        setBatchResults(newResults);

        // Send batched summary back to agent
        if (onBatchResult) {
          const batchSummary = formatBatchedResultsForAgent(batchResult);
          onBatchResult(batchSummary);
        }
      });
    }
  }, [autoExecCommands, trackCommand, setCommandState, approveCommand, onResult, onBatchResult]);

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
            onClick={() => { setAllowAll(true); }}
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
          // Pass pre-computed result if we batch-executed this command
          batchResult={batchResults.get(cmd.id)}
        />
      ))}
    </div>
  );
}
