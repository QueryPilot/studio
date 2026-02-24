import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconDownload,
  IconLoader2,
  IconAlertCircle,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react";
import { type ConnectionProfile } from "@/types/connection";

// ============ Types ============

interface ToolCheckStepProps {
  profile: ConnectionProfile;
  onToolsReady: () => void;
  onBack: () => void;
}

interface ToolInfo {
  name: string;
  description: string;
  versionCommand: string;
  downloadUrl: string | null;
  downloadSizeMb: number;
}

interface ToolCheckStatus {
  name: string;
  installed: boolean;
  path: string | null;
  version: string | null;
}

interface ToolStatus {
  requiredTools: ToolInfo[];
  toolStatuses: ToolCheckStatus[];
  available: string[];
  missing: string[];
}

interface InstallInstructions {
  packageManager: string;
  command: string;
  notes: string | null;
}

interface ToolDownloadInfo {
  name: string;
  description: string;
  officialUrl: string;
  installInstructions: InstallInstructions[];
  commonPaths: string[];
  autoDownloadSupported: boolean;
}

type InstallStatus = "idle" | "installing" | "success" | "error";

interface ToolInstallState {
  status: InstallStatus;
  error?: string;
  output?: string;
}

type PackageManager = "brew" | "manual";

// ============ Component ============

export const ToolCheckStep = ({
  profile,
  onToolsReady,
  onBack,
}: ToolCheckStepProps) => {
  // Loading and error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tool status
  const [toolStatus, setToolStatus] = useState<ToolStatus | null>(null);
  const [downloadInfo, setDownloadInfo] = useState<
    Record<string, ToolDownloadInfo>
  >({});

  // Install states
  const [installStates, setInstallStates] = useState<
    Record<string, ToolInstallState>
  >({});
  const [selectedMethod, setSelectedMethod] = useState<PackageManager>("brew");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch tool status on mount
  useEffect(() => {
    let mounted = true;

    async function checkTools() {
      try {
        setLoading(true);
        setError(null);

        // Get tool status for this database type
        const status = await invoke<ToolStatus>("get_tool_status", {
          dbType: profile.db_type,
        });

        if (!mounted) return;

        setToolStatus(status);

        // If all tools are installed, auto-proceed
        if (status.missing.length === 0) {
          onToolsReady();
          return;
        }

        // Fetch download info for missing tools
        const infoMap: Record<string, ToolDownloadInfo> = {};
        for (const toolName of status.missing) {
          try {
            const info = await invoke<ToolDownloadInfo>("get_tool_download_info", {
              toolName,
            });
            if (mounted) {
              infoMap[toolName] = info;
            }
          } catch (err) {
            logger.warn(
              "backup-restore",
              `Failed to get download info for ${toolName}:`,
              err
            );
          }
        }

        if (mounted) {
          setDownloadInfo(infoMap);
        }
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof Error ? err.message : String(err);
        logger.error("backup-restore", "Failed to check tools:", err);
        setError(message);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void checkTools();

    return () => {
      mounted = false;
    };
  }, [profile.db_type, onToolsReady]);

  // Handle copying install command to clipboard
  const handleCopyCommand = useCallback(
    async (command: string) => {
      try {
        await navigator.clipboard.writeText(command);
      } catch (err) {
        logger.error("backup-restore", "Failed to copy command:", err);
      }
    },
    []
  );

  // Handle tool installation via brew
  const handleInstall = useCallback(
    async (toolName: string) => {
      const info = downloadInfo[toolName];
      if (!info) return;

      if (selectedMethod === "manual") {
        // Manual - open the URL
        if (info.officialUrl) {
          window.open(info.officialUrl, "_blank", "noopener,noreferrer");
        }
        return;
      }

      // Find brew install package name
      const brewInstruction = info.installInstructions.find(
        (i) => i.packageManager.toLowerCase().includes("homebrew")
      );

      if (!brewInstruction) {
        setInstallStates((prev) => ({
          ...prev,
          [toolName]: { status: "error", error: "No Homebrew package available" },
        }));
        return;
      }

      // Extract package name from "brew install <package>"
      const match = brewInstruction.command.match(/brew install (.+)/);
      const packageName = match?.[1]?.trim();
      if (!packageName) {
        setInstallStates((prev) => ({
          ...prev,
          [toolName]: { status: "error", error: "Invalid brew command" },
        }));
        return;
      }

      setInstallStates((prev) => ({
        ...prev,
        [toolName]: { status: "installing" },
      }));

      try {
        const output = await invoke<string>("install_tool_via_brew", { packageName });
        setInstallStates((prev) => ({
          ...prev,
          [toolName]: { status: "success", output },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("backup-restore", `Failed to install ${toolName}:`, err);
        setInstallStates((prev) => ({
          ...prev,
          [toolName]: { status: "error", error: message },
        }));
      }
    },
    [downloadInfo, selectedMethod]
  );

  // Refresh tool status
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const status = await invoke<ToolStatus>("get_tool_status", {
        dbType: profile.db_type,
      });

      setToolStatus(status);

      // Update install states based on new status
      const newInstallStates: Record<string, ToolInstallState> = {};
      for (const toolName of status.available) {
        if (installStates[toolName]?.status !== "success") {
          newInstallStates[toolName] = { status: "success" };
        }
      }
      if (Object.keys(newInstallStates).length > 0) {
        setInstallStates((prev) => ({ ...prev, ...newInstallStates }));
      }

      // If all tools are now available, proceed
      if (status.missing.length === 0) {
        onToolsReady();
      }
    } catch (err) {
      logger.error("backup-restore", "Failed to refresh tool status:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [profile.db_type, installStates, onToolsReady]);

  // Check if all tools are ready (installed or successfully installed)
  const allToolsReady =
    toolStatus?.missing.length === 0 ||
    toolStatus?.missing.every(
      (name) => installStates[name]?.status === "success"
    );

  // ============ Render Loading ============
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label="Go back"
          >
            <IconArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-xl font-semibold">Checking Required Tools</h2>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">
              Checking for required backup tools...
            </span>
          </div>
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  // ============ Render Error ============
  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label="Go back"
          >
            <IconArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-xl font-semibold">Tool Check Failed</h2>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive select-text">
          <IconAlertCircle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Failed to check tool status</p>
            <p className="text-sm opacity-80">{error}</p>
          </div>
        </div>

        <Button variant="outline" onClick={onBack}>
          Go Back
        </Button>
      </div>
    );
  }

  // ============ Render - All Tools Ready ============
  if (!toolStatus || toolStatus.missing.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            aria-label="Go back"
          >
            <IconArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-xl font-semibold">Tools Ready</h2>
        </div>

        <div className="flex items-center gap-3 p-4 rounded-lg bg-green-500/10 text-green-600 dark:text-green-500">
          <IconCheck className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">All required tools are installed</p>
            <p className="text-sm opacity-80">
              You can proceed with the backup operation.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onToolsReady}>Continue</Button>
        </div>
      </div>
    );
  }

  // ============ Render - Missing Tools ============
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          aria-label="Go back"
        >
          <IconArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xl font-semibold">Install Required Tools</h2>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-500">
        <IconAlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Missing backup tools</p>
          <p className="text-sm opacity-80">
            The following tools are required for {profile.db_type} backup/restore
            but are not installed on your system.
          </p>
        </div>
      </div>

      {/* Installation Method */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Installation Method</Label>
        <Select
          value={selectedMethod}
          onValueChange={(v) => setSelectedMethod(v as PackageManager)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="brew">Homebrew (Recommended)</SelectItem>
            <SelectItem value="manual">Manual Installation</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tool List */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Required Tools</Label>
        {toolStatus.missing.map((toolName) => {
          const info = downloadInfo[toolName];
          const toolInfo = toolStatus.requiredTools.find(
            (t) => t.name === toolName
          );
          const state = installStates[toolName] || { status: "idle" };
          const isInstalled = state.status === "success";

          // Get install command
          const brewInstruction = info?.installInstructions.find(
            (i) => i.packageManager.toLowerCase().includes("homebrew")
          );
          const installCmd = brewInstruction?.command || `brew install ${toolName}`;

          return (
            <div
              key={toolName}
              className={cn(
                "rounded-md border p-4 space-y-3",
                isInstalled && "border-green-500/50 bg-green-500/5",
                state.status === "error" && "border-destructive/50 bg-destructive/5"
              )}
            >
              {/* Tool name and description */}
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono font-medium">
                  {toolName}
                </code>
                {toolInfo?.description && (
                  <span className="text-xs text-muted-foreground">
                    - {toolInfo.description}
                  </span>
                )}
                {isInstalled && (
                  <IconCheck className="h-4 w-4 text-green-500 ml-auto" />
                )}
              </div>

              {/* Install command with copy button */}
              {!isInstalled && selectedMethod === "brew" && (
                <div className="flex items-center gap-1">
                  <code className="flex-1 text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded">
                    {installCmd}
                  </code>
                  <button
                    type="button"
                    onClick={() => void handleCopyCommand(installCmd)}
                    className="p-1 hover:bg-muted rounded"
                    title="Copy command"
                  >
                    <IconCopy className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </div>
              )}

              {/* Manual install link */}
              {!isInstalled && selectedMethod === "manual" && info?.officialUrl && (
                <a
                  href={info.officialUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <IconExternalLink className="h-3 w-3" />
                  {info.officialUrl}
                </a>
              )}

              {/* Notes */}
              {brewInstruction?.notes && !isInstalled && selectedMethod === "brew" && (
                <p className="text-xs text-muted-foreground">{brewInstruction.notes}</p>
              )}

              {/* Error message */}
              {state.status === "error" && state.error && (
                <p className="text-xs text-destructive">
                  {state.error}
                </p>
              )}

              {/* Installation output */}
              {(state.status === "installing" || state.output) && (
                <div className="mt-2 rounded bg-muted/70 border">
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/50 text-xs text-muted-foreground">
                    {state.status === "installing" ? (
                      <>
                        <IconLoader2 className="h-3 w-3 animate-spin" />
                        <span>Installing via Homebrew...</span>
                      </>
                    ) : (
                      <>
                        <IconCheck className="h-3 w-3 text-green-500" />
                        <span>Installation complete</span>
                      </>
                    )}
                  </div>
                  <pre className="p-3 text-xs font-mono overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
                    {state.output || "Running brew install..."}
                  </pre>
                </div>
              )}

              {/* Install button - at the bottom, aligned right */}
              {!isInstalled && (
                <div className="flex justify-end">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => void handleInstall(toolName)}
                    disabled={state.status === "installing"}
                  >
                    {state.status === "installing" ? (
                      <IconLoader2 className="h-4 w-4 animate-spin" />
                    ) : selectedMethod === "manual" ? (
                      <IconExternalLink className="h-4 w-4" />
                    ) : (
                      <IconDownload className="h-4 w-4" />
                    )}
                    <span className="ml-1.5">
                      {state.status === "installing"
                        ? "Installing..."
                        : selectedMethod === "manual"
                          ? "Open"
                          : "Install"}
                    </span>
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Refresh hint */}
      <p className="text-xs text-muted-foreground">
        {selectedMethod === "brew"
          ? "Click \"Install\" to install via Homebrew. Click \"Refresh\" to check if tools are available."
          : "After installing manually, click \"Refresh\" to check if the tools are available."}
      </p>

      {/* Actions */}
      <div className="flex justify-between gap-3 pt-4">
        <Button
          variant="outline"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <IconRefresh className="h-4 w-4 mr-1.5" />
          )}
          Refresh
        </Button>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onToolsReady} disabled={!allToolsReady}>
            {allToolsReady ? "Continue" : "Install Tools First"}
          </Button>
        </div>
      </div>
    </div>
  );
};
