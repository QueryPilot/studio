import { useState, useEffect, useRef, useCallback } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  IconArrowLeft,
  IconCheck,
  IconX,
  IconLoader2,
  IconPlayerPlay,
  IconDownload,
  IconUpload,
} from "@tabler/icons-react";
import type { BackupConfig } from "./BackupConfigStep";
import type { RestoreConfig } from "./RestoreConfigStep";
import { type ConnectionProfile } from "@/types/connection";

// ============ Types ============

interface ExecuteStepProps {
  profile: ConnectionProfile;
  operation: "backup" | "restore";
  config: BackupConfig | RestoreConfig;
  onComplete: () => void;  // Called to close window or start new
  onBack: () => void;      // Go back to config
}

type ExecuteState = "idle" | "running" | "completed" | "failed";

// BackupProgress is a tagged union from Rust backend
// Each variant has a "type" field that discriminates the union
// Note: Rust uses #[serde(rename_all = "camelCase")] so field names are camelCase
interface BackupProgressStarted {
  type: "Started";
  totalSteps: number | null;
}

interface BackupProgressProgress {
  type: "Progress";
  current: number;
  total: number;
  message: string;
}

interface BackupProgressOutput {
  type: "Output";
  line: string;
  isError: boolean;
}

interface BackupProgressCompleted {
  type: "Completed";
  message: string;
}

interface BackupProgressFailed {
  type: "Failed";
  error: string;
}

type BackupProgress =
  | BackupProgressStarted
  | BackupProgressProgress
  | BackupProgressOutput
  | BackupProgressCompleted
  | BackupProgressFailed;

interface OutputLine {
  line: string;
  isError: boolean;
  timestamp: Date;
}

// Maximum number of output lines to keep in memory
const MAX_OUTPUT_LINES = 500;

// ============ Component ============

export const ExecuteStep = ({
  profile,
  operation,
  config,
  onComplete,
  onBack,
}: ExecuteStepProps) => {
  // Operation state
  const [state, setState] = useState<ExecuteState>("idle");
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [progressMessage, setProgressMessage] = useState("");
  const [outputLines, setOutputLines] = useState<OutputLine[]>([]);
  const [completionMessage, setCompletionMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Refs for cleanup
  const mountedRef = useRef(true);
  const channelRef = useRef<Channel<BackupProgress> | null>(null);
  const outputEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new output is added
  useEffect(() => {
    if (outputEndRef.current) {
      outputEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [outputLines]);

  // Add output line with deduplication and limit
  const addOutputLine = useCallback((line: string, isError: boolean) => {
    setOutputLines((prev) => {
      const newLine: OutputLine = { line, isError, timestamp: new Date() };
      const updated = [...prev, newLine];
      // Keep only the last MAX_OUTPUT_LINES
      if (updated.length > MAX_OUTPUT_LINES) {
        return updated.slice(-MAX_OUTPUT_LINES);
      }
      return updated;
    });
  }, []);

  // Handle progress message from channel
  const handleProgress = useCallback(
    (progress: BackupProgress) => {
      // Ignore messages if component is unmounted
      if (!mountedRef.current) return;

      switch (progress.type) {
        case "Started":
          setState("running");
          setProgressPercent(0);
          setProgressMessage(
            `Starting ${operation === "backup" ? "backup" : "restore"}...`
          );
          if (progress.totalSteps) {
            addOutputLine(
              `Operation started with ${progress.totalSteps} steps`,
              false
            );
          } else {
            addOutputLine("Operation started", false);
          }
          break;

        case "Progress":
          setProgressPercent(
            progress.total > 0
              ? Math.round((progress.current / progress.total) * 100)
              : null
          );
          setProgressMessage(progress.message);
          break;

        case "Output":
          addOutputLine(progress.line, progress.isError);
          break;

        case "Completed":
          setState("completed");
          setProgressPercent(100);
          setProgressMessage("Completed");
          setCompletionMessage(progress.message);
          addOutputLine(`Success: ${progress.message}`, false);
          break;

        case "Failed":
          setState("failed");
          setProgressMessage("Failed");
          setErrorMessage(progress.error);
          addOutputLine(`Error: ${progress.error}`, true);
          break;
      }
    },
    [operation, addOutputLine]
  );

  // Start the operation
  const startOperation = useCallback(async () => {
    try {
      setState("running");
      setProgressPercent(0);
      setProgressMessage("Initializing...");
      setOutputLines([]);
      setCompletionMessage("");
      setErrorMessage("");

      // Create a channel to receive progress events
      const channel = new Channel<BackupProgress>();
      channelRef.current = channel;
      channel.onmessage = handleProgress;

      // Call the appropriate command
      if (operation === "backup") {
        await invoke("start_backup", {
          profile,
          config: config as BackupConfig,
          channel,
        });
      } else {
        await invoke("start_restore", {
          profile,
          config: config as RestoreConfig,
          channel,
        });
      }
    } catch (err) {
      // Handle errors that occur before the channel receives progress
      const message = err instanceof Error ? err.message : String(err);
      logger.error("backup-restore", `Failed to start ${operation}:`, err);
      setState("failed");
      setErrorMessage(message);
      addOutputLine(`Error: ${message}`, true);
    }
  }, [profile, operation, config, handleProgress, addOutputLine]);

  // Auto-start on mount and cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    void startOperation();

    return () => {
      mountedRef.current = false;
      // Clear channel handler to prevent updates after unmount
      if (channelRef.current) {
        channelRef.current.onmessage = () => {};
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run once on mount
  }, []);

  // Get operation display name
  const operationName = operation === "backup" ? "Backup" : "Restore";
  const OperationIcon = operation === "backup" ? IconDownload : IconUpload;

  // ============ Render ============
  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2">
        {(state === "idle" || state === "failed") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label="Go back to configuration"
          >
            <IconArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <OperationIcon className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-xl font-semibold">{operationName} in Progress</h2>
      </div>

      {/* Status Section */}
      <div className="space-y-4">
        {/* Status Badge */}
        <div className="flex items-center gap-3">
          {state === "idle" && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <IconPlayerPlay className="h-5 w-5" />
              <span>Ready to start</span>
            </div>
          )}
          {state === "running" && (
            <div className="flex items-center gap-2 text-primary">
              <IconLoader2 className="h-5 w-5 animate-spin" />
              <span>Running...</span>
            </div>
          )}
          {state === "completed" && (
            <div className="flex items-center gap-2 text-green-600 dark:text-green-500">
              <IconCheck className="h-5 w-5" />
              <span>{operationName} Completed</span>
            </div>
          )}
          {state === "failed" && (
            <div className="flex items-center gap-2 text-destructive">
              <IconX className="h-5 w-5" />
              <span>{operationName} Failed</span>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        {(state === "running" || state === "completed") && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{progressMessage}</span>
              {progressPercent !== null && (
                <span className="text-muted-foreground tabular-nums">
                  {progressPercent}%
                </span>
              )}
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-[width] duration-300 ease-out"
                style={{ width: `${progressPercent ?? 0}%` }}
              />
            </div>
          </div>
        )}

        {/* Completion Message */}
        {state === "completed" && completionMessage && (
          <div className="p-4 rounded-lg bg-green-500/10 text-green-600 dark:text-green-500">
            <p className="font-medium">{completionMessage}</p>
          </div>
        )}

        {/* Error Message */}
        {state === "failed" && errorMessage && (
          <div className="p-4 rounded-lg bg-destructive/10 text-destructive">
            <p className="font-medium">Error</p>
            <p className="text-sm mt-1 opacity-90">{errorMessage}</p>
          </div>
        )}
      </div>

      {/* Output Log */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-muted-foreground">
            Output Log
          </span>
          {outputLines.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {outputLines.length} lines
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0 border rounded-md bg-muted/30">
          <ScrollArea className="h-48 min-h-[12rem] max-h-[24rem]">
            <div className="p-3 font-mono text-xs space-y-0.5">
              {outputLines.length === 0 ? (
                <p className="text-muted-foreground italic">
                  {state === "idle"
                    ? "Output will appear here when the operation starts..."
                    : "Waiting for output..."}
                </p>
              ) : (
                outputLines.map((output, index) => (
                  <div
                    key={index}
                    className={output.isError ? "text-destructive" : "text-foreground"}
                  >
                    {output.line}
                  </div>
                ))
              )}
              <div ref={outputEndRef} />
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4">
        {/* Back button - only in idle or failed state */}
        {(state === "idle" || state === "failed") && (
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        )}

        {/* Retry button - only in failed state */}
        {state === "failed" && (
          <Button onClick={() => void startOperation()}>
            <IconPlayerPlay className="h-4 w-4 mr-1.5" />
            Retry
          </Button>
        )}

        {/* Done button - only in completed state */}
        {state === "completed" && (
          <Button onClick={onComplete}>
            <IconCheck className="h-4 w-4 mr-1.5" />
            Done
          </Button>
        )}

        {/* Running state - show disabled button */}
        {state === "running" && (
          <Button disabled>
            <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
            {operationName} in Progress...
          </Button>
        )}
      </div>
    </div>
  );
};
