/**
 * Agent Install Dialog Component
 *
 * Shows installation instructions for an AI agent that isn't installed yet.
 * Provides install buttons for each required package with package manager selection.
 */

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IconArrowUp,
  IconDownload,
  IconCheck,
  IconExternalLink,
  IconAlertCircle,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import type { AgentInfo, PackageInfo, NpmPackageManager } from "@/types/acp";
import { useAcpStore } from "@/stores/acpStore";
import { AcpService } from "@/services/acpService";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";

interface AgentInstallDialogProps {
  agent: AgentInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type InstallStatus = "idle" | "installing" | "success" | "error";

interface PackageInstallState {
  status: InstallStatus;
  error?: string;
}

const NPM_MANAGERS: { value: NpmPackageManager; label: string }[] = [
  { value: "npm", label: "npm" },
  { value: "pnpm", label: "pnpm" },
  { value: "yarn", label: "yarn" },
  { value: "bun", label: "bun" },
];

export function AgentInstallDialog({
  agent,
  open,
  onOpenChange,
}: AgentInstallDialogProps) {
  const { loadAgents, preferredPackageManager, setPreferredPackageManager } = useAcpStore();
  const packageManager = preferredPackageManager;
  const [packageStates, setPackageStates] = useState<
    Record<string, PackageInstallState>
  >({});
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleInstall = useCallback(
    async (pkg: PackageInfo) => {
      setPackageStates((prev) => ({
        ...prev,
        [pkg.name]: { status: "installing" },
      }));

      try {
        const pm = pkg.managerType === "brew" ? "brew" : packageManager;

        if (pkg.updateAvailable) {
          // Upgrade mode: use the upgrade endpoint
          const binaryName = agent?.id === "codex-acp" ? "codex" : "claude";
          await AcpService.upgradePackage(
            pkg.name,
            pkg.managerType,
            binaryName,
            pkg.managerType === "npm" ? pm as NpmPackageManager : undefined
          );
        } else {
          await AcpService.installPackage(pkg.name, pkg.managerType, pm);
        }

        setPackageStates((prev) => ({
          ...prev,
          [pkg.name]: { status: "success" },
        }));
      } catch (err) {
        setPackageStates((prev) => ({
          ...prev,
          [pkg.name]: {
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          },
        }));
      }
    },
    [packageManager, agent?.id]
  );

  const handleOpenDocs = useCallback(async () => {
    if (!agent?.installUrl) return;

    try {
      await openUrl(agent.installUrl);
    } catch {
      // Fallback to window.open for browser mode
      window.open(agent.installUrl, "_blank", "noopener,noreferrer");
    }
  }, [agent?.installUrl]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadAgents();
      onOpenChange(false);
    } catch (err) {
      console.error("Failed to refresh agents:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadAgents, onOpenChange]);

  const handleClose = useCallback(() => {
    // Reset states when closing
    setPackageStates({});
    onOpenChange(false);
  }, [onOpenChange]);

  if (!agent) return null;

  const isClaudeCode = agent.id === "claude-code-acp";
  const isCodex = agent.id === "codex-acp";
  const hasNpmPackages = agent.packages.some((p) => p.managerType === "npm");
  const isUpgradeMode = agent.installed && agent.packages.some((p) => p.updateAvailable);
  const allInstalled = agent.packages.every(
    (p) => p.installed || packageStates[p.name]?.status === "success"
  );
  const allUpToDate = !agent.packages.some(
    (p) => p.updateAvailable && packageStates[p.name]?.status !== "success"
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isUpgradeMode ? `Update ${agent.name}` : `Install ${agent.name}`}</DialogTitle>
          <DialogDescription>
            {isUpgradeMode
              ? `Updates are available for ${agent.name} packages.`
              : `${agent.name} is not installed on your system. Install the required packages below.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Package Manager Selector (for npm packages) */}
          {hasNpmPackages && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Package Manager</Label>
              <Select
                value={packageManager}
                onValueChange={(v) => { setPreferredPackageManager(v as NpmPackageManager); }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NPM_MANAGERS.map((pm) => (
                    <SelectItem key={pm.value} value={pm.value}>
                      {pm.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Package List */}
          <div className="space-y-3">
            <Label className="text-xs font-medium">{isUpgradeMode ? "Packages" : "Required Packages"}</Label>
            {agent.packages.map((pkg) => {
              const state = packageStates[pkg.name] || { status: "idle" };
              const installCmd =
                pkg.managerType === "brew"
                  ? `brew install ${pkg.name}`
                  : `${packageManager} install -g ${pkg.name}`;

              const isInstalled = pkg.installed || state.status === "success";
              const needsUpdate = pkg.updateAvailable && state.status !== "success";
              const isDone = isInstalled && !needsUpdate;

              return (
                <div
                  key={pkg.name}
                  className={cn(
                    "flex items-center gap-2 rounded-md border p-3",
                    isDone && "border-green-500/50 bg-green-500/5",
                    needsUpdate && "border-amber-500/50 bg-amber-500/5",
                    state.status === "error" && "border-destructive/50 bg-destructive/5"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono truncate">
                        {pkg.name}
                      </code>
                      <span className="text-xs text-muted-foreground">
                        ({pkg.description})
                      </span>
                    </div>
                    {needsUpdate && pkg.installedVersion && pkg.latestVersion && (
                      <p className="text-[11px] text-amber-500 mt-0.5 font-mono">
                        v{pkg.installedVersion} → v{pkg.latestVersion}
                      </p>
                    )}
                    {!isInstalled && !needsUpdate && (
                      <code className="text-[10px] text-muted-foreground font-mono">
                        {installCmd}
                      </code>
                    )}
                    {state.status === "error" && state.error && (
                      <p className="text-xs text-destructive mt-1 truncate">
                        {state.error}
                      </p>
                    )}
                  </div>
                  <Button
                    variant={isDone ? "ghost" : "outline"}
                    size="sm"
                    onClick={() => void handleInstall(pkg)}
                    disabled={isDone || state.status === "installing"}
                    className="shrink-0"
                  >
                    {state.status === "installing" ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isDone ? (
                      <IconCheck className="h-3.5 w-3.5 text-green-500" />
                    ) : state.status === "error" ? (
                      <IconX className="h-3.5 w-3.5 text-destructive" />
                    ) : needsUpdate ? (
                      <IconArrowUp className="h-3.5 w-3.5 text-amber-500" />
                    ) : (
                      <IconDownload className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1.5">
                      {state.status === "installing"
                        ? needsUpdate ? "Updating..." : "Installing..."
                        : isDone
                          ? needsUpdate ? "Updated" : "Installed"
                          : state.status === "error"
                            ? "Retry"
                            : needsUpdate
                              ? "Update"
                              : "Install"}
                    </span>
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Documentation Link */}
          {agent.installUrl && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Documentation</Label>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2 text-xs"
                onClick={() => void handleOpenDocs()}
              >
                <IconExternalLink className="h-3.5 w-3.5" />
                View installation guide
              </Button>
            </div>
          )}

          {/* Claude Code API Key Note */}
          {isClaudeCode && (
            <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-xs">
              <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-amber-500">API Key Required</p>
                <p className="text-muted-foreground">
                  Claude Code requires an Anthropic API key. You will be prompted
                  to enter it when you first run the agent, or you can set the{" "}
                  <code className="rounded bg-muted px-1">ANTHROPIC_API_KEY</code>{" "}
                  environment variable.
                </p>
              </div>
            </div>
          )}

          {/* Codex API Key Note */}
          {isCodex && (
            <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-xs">
              <IconAlertCircle className="h-4 w-4 shrink-0 text-amber-500 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium text-amber-500">API Key Required</p>
                <p className="text-muted-foreground">
                  Codex requires an OpenAI API key. Set the{" "}
                  <code className="rounded bg-muted px-1">OPENAI_API_KEY</code>{" "}
                  environment variable before using this agent.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleRefresh()}
            disabled={isRefreshing || (isUpgradeMode ? !allUpToDate : !allInstalled)}
          >
            {isRefreshing && (
              <IconLoader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
            )}
            {isUpgradeMode
              ? allUpToDate ? "Done" : "Update All First"
              : allInstalled ? "Done" : "Install All First"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
